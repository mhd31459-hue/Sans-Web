import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applies, clean, presetOf, withPreset, PRESETS } from "../extension/src/profiles.js";
import { decide, prepare } from "../extension/src/segments.js";
import { profanityForCue, wordSeverity } from "../supabase/functions/_shared/profanity.ts";

const seg = (category, severity, extra = {}) => ({ start: 10, end: 20, category, severity, source: "ai", status: "draft", ...extra });

test("strength threshold: strong-only lets mild and moderate through", () => {
  const adults = PRESETS.adults.settings;
  assert.equal(applies(seg("violence", 2), adults), false);
  assert.equal(applies(seg("violence", 3), adults), true);
  assert.equal(applies(seg("violence", 1), PRESETS.kids.settings), true);
});

test("confirmed only: drafts wait, confirmed scenes, subtitle swears and own reports don't", () => {
  const s = { ...PRESETS.kids.settings, confirmedOnly: true };
  assert.equal(applies(seg("sex", 3), s), false);
  assert.equal(applies(seg("sex", 3, { status: "confirmed" }), s), true);
  assert.equal(applies(seg("profanity", 3, { source: "captions" }), s), true);
  assert.equal(applies(seg("violence", 2, { source: "report", mine: true }), s), true);
});

test("off is off", () => assert.equal(applies(seg("nudity", 3), { ...PRESETS.kids.settings, nudity: { action: "off", min: 1 } }), false));

test("old string prefs keep working and migrate at mild-and-up", () => {
  const c = clean({ profanity: "mute", violence: "off" });
  assert.deepEqual(c.profanity, { action: "mute", min: 1 });
  assert.deepEqual(c.violence, { action: "off", min: 1 });
  assert.deepEqual(c.nudity, { action: "skip", min: 1 });     // missing → default
  assert.equal(clean({ profanity: { action: "skip", min: 9 } }).profanity.action, "mute"); // language can't skip
});

test("presets are recognised regardless of confirmed-only", () => {
  const s = withPreset({ confirmedOnly: true }, "teens");
  assert.equal(presetOf(s), "teens");
  assert.equal(s.confirmedOnly, true);
  assert.equal(presetOf({ ...s, violence: { action: "cover", min: 1 } }), null);
});

test("filtering happens before merging, so a strong neighbour doesn't swallow a mild scene", () => {
  const raw = [{ ...seg("violence", 1), start: 0, end: 60 }, { ...seg("violence", 3), start: 60.5, end: 65 }];
  const segs = prepare(raw, PRESETS.adults.settings);
  assert.deepEqual(segs.map(s => [s.start, s.end]), [[60.5, 65]]);
  assert.equal(decide(30, segs, PRESETS.adults.settings).skipTo, null);
  assert.equal(decide(61, segs, PRESETS.adults.settings).skipTo, 65);
});

test("word tiers: damn mild, sh*t moderate, f-word strong", () => {
  assert.deepEqual(["damn", "shit", "bullshit", "fucking", "Motherfucker"].map(wordSeverity), [1, 2, 2, 3, 3]);
  const segs = profanityForCue({ t: 0, end: 6, text: "Damn it, that's a long way to go, and fuck this." });
  assert.deepEqual(segs.map(s => s.severity), [1, 3]);
  // A teen profile (moderate and up) mutes the f-word but not "damn".
  assert.deepEqual(prepare(segs, PRESETS.teens.settings).map(s => s.severity), [3]);
});

test("website and extension share one profile model", () => {
  const a = readFileSync(new URL("../extension/src/profiles.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../docs/profiles.js", import.meta.url), "utf8");
  assert.equal(a, b, "copy extension/src/profiles.js to docs/profiles.js");
});

test("database validator accepts what clean() produces", () => {
  // Mirrors valid_profile_settings() in the migration: each category has action + min 1–3.
  const sql = readFileSync(new URL("../supabase/migrations/20261123000000_profiles_and_severity.sql", import.meta.url), "utf8");
  for (const a of ["off", "mute", "cover", "skip"]) assert.match(sql, new RegExp(`'${a}'`));
  const s = clean({});
  for (const c of ["profanity", "nudity", "sex", "violence"]) assert.ok([1, 2, 3].includes(s[c].min) && typeof s[c].action === "string");
  assert.equal(typeof s.confirmedOnly, "boolean");
});

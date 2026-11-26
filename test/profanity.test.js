import { test } from "node:test";
import assert from "node:assert/strict";
import { profanityForCue, profanitySegments, spokenText } from "../supabase/functions/_shared/profanity.ts";

test("word-level: mutes the word, not the whole 2s line", () => {
  const [s] = profanityForCue({ t: 10, end: 12, text: "Get the fuck down, now!" });
  assert.ok(s.start >= 9.9 && s.start <= 10.3, `start ${s.start}`);
  assert.ok(s.end >= 11.0 && s.end <= 11.4, `end ${s.end}`);
  assert.ok(s.end - s.start < 1.5, "shorter than the 2s line");
});

// Regression from a real recording: the line was shown ~2s, spoken in 0.7s, and the
// swear (heard at +0.34–0.58s) got through because the mute started at +0.71s.
test("fast speech in a lingering caption is still covered", () => {
  const [s] = profanityForCue({ t: 30.22, end: 32.3, text: "It's kinda fucked up." });
  assert.ok(s.start <= 30.56 - 0.1 && s.end >= 30.80 + 0.1, `${s.start}–${s.end}`);
});

// Second real recording: swear at the END of a line, heard +0.58–0.94s, old mute began +1.05s.
test("fast swear at the end of a line is covered", () => {
  const [s] = profanityForCue({ t: 4.48, end: 6.5, text: "The dining site is bullshit." });
  assert.ok(s.start <= 5.06 - 0.1 && s.end >= 5.42 + 0.1, `${s.start}–${s.end}`);
});

test("slow speech across the whole cue is still covered", () => {
  // Same line spoken slowly enough to fill the cue: the word sits ~1.1–1.7s in.
  const [s] = profanityForCue({ t: 30.22, end: 32.3, text: "It's kinda fucked up." });
  assert.ok(s.start <= 30.22 + 1.1 && s.end >= 30.22 + 1.7, `${s.start}–${s.end}`);
});

test("word at the end of the line: starts early enough for fast speech, ends with the cue", () => {
  const [s] = profanityForCue({ t: 100, end: 103, text: "And you know what? That's bullshit." });
  assert.ok(s.start <= 100 + 26 / 28, `start ${s.start}`);
  assert.ok(s.end >= 102.9 && s.end <= 103.2, `end ${s.end}`);
});

test("never shorter than the minimum mute", () => {
  const [s] = profanityForCue({ t: 5, end: 9, text: "Well, I suppose it is rather a long story, damn." });
  assert.ok(s.end - s.start >= 0.59);
});

test("two swears in one line: two mutes, or one merged if they touch", () => {
  const far = profanityForCue({ t: 0, end: 6, text: "Shit, I don't know what to tell you anymore, honestly, fuck." });
  assert.equal(far.length, 2);
  const near = profanityForCue({ t: 0, end: 2, text: "Shit shit shit!" });
  assert.equal(near.length, 1);
});

test("sound cues and speaker tags are not spoken, so they don't shift timing", () => {
  assert.equal(spokenText("[gunfire] SOLDIER: Get the fuck down!"), "Get the fuck down!");
  const withTag = profanityForCue({ t: 10, end: 12, text: "[gunfire] SOLDIER: Get the fuck down, now!" })[0];
  const plain = profanityForCue({ t: 10, end: 12, text: "Get the fuck down, now!" })[0];
  assert.deepEqual(withTag, plain);
});

test("a sound cue alone is never profanity; clean lines produce nothing", () => {
  assert.equal(profanityForCue({ t: 1, end: 2, text: "[gunshot]" }).length, 0);
  assert.equal(profanitySegments([{ t: 1, end: 2, text: "Theo. Lord of Pelargir." }]).length, 0);
});

test("screen-read cues (no end) use the next cue's start, capped", () => {
  const segs = profanitySegments([{ t: 40, text: "What the fuck was that?" }, { t: 42, text: "ok" }]);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].start >= 40 && segs[0].end <= 42.2);
});

test("compounds still caught; ordinary words still not", () => {
  for (const t of ["That's bullshit.", "motherfucker", "dipshit"]) assert.equal(profanityForCue({ t: 0, end: 2, text: t }).length, 1, t);
  for (const t of ["Dickens", "the cockpit", "shiitake"]) assert.equal(profanityForCue({ t: 0, end: 2, text: t }).length, 0, t);
});

test("ass: itself and known compounds are mild; ordinary words are not caught", async () => {
  const { PROFANITY_SRC, wordSeverity } = await import("../supabase/functions/_shared/profanity.ts");
  const found = (line) => [...line.matchAll(new RegExp(PROFANITY_SRC, "gi"))].map(m => m[0].toLowerCase());
  assert.deepEqual(found("Get your ass in here, jackass."), ["ass", "jackass"]);
  assert.deepEqual(found("A half-assed plan by a dumbass."), ["half-assed", "dumbass"]);
  assert.deepEqual(found("Kiss my ass. Asses."), ["ass", "asses"]);
  assert.deepEqual(found("Pass the glass of bass to the class; assess the assassin's mass."), []);
  assert.equal(wordSeverity("ass"), 1); assert.equal(wordSeverity("jackass"), 1);
  assert.equal(wordSeverity("asshole"), 2);
});

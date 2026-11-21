import { test } from "node:test";
import assert from "node:assert/strict";
import { profanityForCue, profanitySegments, spokenText } from "../supabase/functions/_shared/profanity.ts";

test("word-level: mutes the word, not the whole 2s line", () => {
  const [s] = profanityForCue({ t: 10, end: 12, text: "Get the fuck down, now!" });
  assert.ok(s.start >= 10.3 && s.start <= 10.6, `start ${s.start}`);
  assert.ok(s.end >= 11.0 && s.end <= 11.4, `end ${s.end}`);
  assert.ok(s.end - s.start < 1.0, "much shorter than the 2s line");
});

test("word at the end of the line lands late in the cue", () => {
  const [s] = profanityForCue({ t: 100, end: 103, text: "And you know what? That's bullshit." });
  assert.ok(s.start > 101.8, `start ${s.start}`);
  assert.ok(s.end <= 103.2);
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

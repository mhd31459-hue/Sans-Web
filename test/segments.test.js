import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, normalize } from "../extension/src/segments.js";

const prefs = { profanity: "mute", nudity: "skip", sex: "skip", violence: "cover" };
const map = [
  { start: 10, end: 12, category: "profanity" },
  { start: 30, end: 45, category: "sex" },
  { start: 45, end: 50, category: "nudity" },
  { start: 60, end: 70, category: "violence" },
];

test("plays normally outside segments", () =>
  assert.deepEqual(decide(5, map, prefs), { mute: false, cover: false, skipTo: null }));
test("mutes during profanity", () => assert.equal(decide(11, map, prefs).mute, true));
test("unmutes at segment end (end is exclusive)", () => assert.equal(decide(12, map, prefs).mute, false));
test("skip chains through back-to-back skip segments", () =>
  assert.equal(decide(31, map, prefs).skipTo, 50));
test("cover also mutes", () =>
  assert.deepEqual(decide(65, map, prefs), { mute: true, cover: true, skipTo: null }));
test("'off' category is ignored", () =>
  assert.deepEqual(decide(65, map, { ...prefs, violence: "off" }), { mute: false, cover: false, skipTo: null }));
test("normalize merges fragmented AI drafts of the same category", () => {
  const n = normalize([
    { start: 30, end: 33, category: "sex", severity: 1 },
    { start: 33.5, end: 40, category: "sex", severity: 3 },
    { start: 35, end: 36, category: "violence", severity: 2 },
  ]);
  assert.deepEqual(n.map(s => [s.category, s.start, s.end, s.severity]),
    [["sex", 30, 40, 3], ["violence", 35, 36, 2]]);
});
test("normalize drops zero/negative-length segments", () =>
  assert.equal(normalize([{ start: 5, end: 5, category: "sex" }]).length, 0));

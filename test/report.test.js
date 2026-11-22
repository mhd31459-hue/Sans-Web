import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportSegment, isReportHotkey, REPORT_WINDOW } from "../extension/src/report.js";
import { decide, DEFAULT_PREFS } from "../extension/src/segments.js";

test("a violence report covers what was just seen and skips ahead now", () => {
  const s = reportSegment(1395, "violence");
  assert.deepEqual([s.start, s.end, s.source], [1375, 1405, "report"]);
  assert.equal(decide(1395, [s], DEFAULT_PREFS).skipTo, 1405);
});

test("a language report is short: the swear is already over", () => {
  const s = reportSegment(600, "profanity");
  assert.ok(s.end - s.start <= 10);
  assert.equal(decide(600.5, [s], DEFAULT_PREFS).mute, true);
});

test("never starts before 0", () => {
  assert.equal(reportSegment(5, "violence").start, 0);
});

test("hotkey is Alt/Option+M only", () => {
  assert.ok(isReportHotkey({ code: "KeyM", altKey: true, ctrlKey: false, metaKey: false }));
  assert.ok(!isReportHotkey({ code: "KeyM", altKey: false, ctrlKey: false, metaKey: false }));   // plain M = Netflix mute
  assert.ok(!isReportHotkey({ code: "KeyM", altKey: true, ctrlKey: false, metaKey: true }));
});

test("extension and server use the same report windows", () => {
  const src = readFileSync(new URL("../supabase/functions/report/index.ts", import.meta.url), "utf8");
  for (const [cat, [b, a]] of Object.entries(REPORT_WINDOW))
    assert.match(src, new RegExp(`${cat}: \\[${b}, ${a}\\]`), cat);
});

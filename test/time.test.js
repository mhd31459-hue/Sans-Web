import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, parse, esc } from "../docs/time.js";

test("fmt", () => {
  assert.equal(fmt(0), "0:00"); assert.equal(fmt(62), "1:02"); assert.equal(fmt(3723), "1:02:03");
});
test("parse accepts h:mm:ss, m:ss, seconds", () => {
  assert.equal(parse("1:02:03"), 3723); assert.equal(parse("62:03"), 3723);
  assert.equal(parse("3723"), 3723); assert.equal(parse("12.5"), 12.5);
});
test("parse rejects junk instead of guessing", () => {
  for (const v of ["", "abc", "1:2:3:4", "1:75", "-5", "1:-2"]) assert.ok(Number.isNaN(parse(v)), v);
});
test("round trip", () => { for (const s of [0, 59, 61, 3599, 3723, 7385]) assert.equal(parse(fmt(s)), s); });
test("esc neutralises markup from page titles", () =>
  assert.equal(esc(`<img src=x onerror="alert(1)">'`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;"));

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTTML, parseVTT, looksLikeCaptions, estimateOffset } from "../extension/src/captions-core.js";

const TTML = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" ttp:tickRate="10000000"><body><div>
<p begin="857200000t" end="880000000t">Your father's passing<br/>has left us in a tangle.</p>
<p begin="00:01:35.720" end="00:01:37.000">Your brother seems to be<br />gathering support.</p>
<p begin="96.97s" dur="2s">That is complete bullshit &amp; you know it.</p>
</div></body></tt>`;

test("TTML: ticks, clock time, seconds+dur; <br> becomes a space (no fused words)", () => {
  const c = parseTTML(TTML);
  assert.equal(c.length, 3);
  assert.equal(c[0].text, "Your father's passing has left us in a tangle.");
  assert.equal(+c[0].start.toFixed(2), 85.72);
  assert.equal(+c[1].start.toFixed(2), 95.72);
  assert.equal(+c[2].end.toFixed(2), 98.97);
  assert.equal(c[2].text, "That is complete bullshit & you know it.");
});

const VTT = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

1
00:00:12.500 --> 00:00:15.000 line:85%
What the <i>fuck</i>
was that?

2
01:02.000 --> 01:04.000
Theo. Lord of Pelargir.`;

test("VTT: hour and minute forms, cue settings ignored, tags stripped", () => {
  const c = parseVTT(VTT);
  assert.deepEqual(c.map(x => [x.start, x.end, x.text]),
    [[12.5, 15, "What the fuck was that?"], [62, 64, "Theo. Lord of Pelargir."]]);
});

test("format sniffing", () => {
  assert.equal(looksLikeCaptions(TTML), "ttml");
  assert.equal(looksLikeCaptions(VTT), "vtt");
  assert.equal(looksLikeCaptions('{"json":true}'), null);
  assert.equal(looksLikeCaptions("<html><p>hi</p></html>"), null);
});

test("alignment: recovers a constant offset from on-screen captions", () => {
  const file = parseTTML(TTML).concat(parseVTT(VTT));
  // screen saw each line 4.25s later than the file says (e.g. a pre-roll), one as a fragment
  const screen = [
    { t: 85.72 + 4.25, text: "Your father's passing has left us in a tangle." },
    { t: 95.72 + 4.25, text: "Your brother seems to be gathering support." },
    { t: 62 + 4.25, text: "Theo. Lord of Pelargir." },
  ];
  const r = estimateOffset(screen, file);
  assert.equal(r.matches, 3);
  assert.equal(+r.offset.toFixed(2), 4.25);
});

test("alignment: refuses to guess with too few or disagreeing matches", () => {
  const file = parseTTML(TTML);
  assert.equal(estimateOffset([{ t: 90, text: "Your father's passing has left us in a tangle." }], file).offset, null);
});

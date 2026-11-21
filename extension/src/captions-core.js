// Pure caption logic (no DOM, so it runs in Node tests):
//  - parse TTML/DFXP (Prime) and WebVTT (Disney+) caption files the player downloads
//  - find profanity in cues, so it can be muted BEFORE it's spoken
//  - align the file's timeline to the player's clock using captions seen on screen

// \w* on both sides of the strong roots catches compounds (bullshit, motherfucker);
// short words that are substrings of ordinary words keep strict boundaries.
// KEEP IN SYNC with supabase/functions/draft-map/index.ts.
export const PROFANITY = /\b(\w*fuck\w*|\w*shit\w*|bitch\w*|cunt\w*|\w*asshole\w*|bastard\w*|dick|dicks|cock|cocks|pussy|goddamn\w*|damn|damned|damnit)\b/i;

const decode = (s) => s
  .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, " ").trim();

// TTML time expressions: "00:01:25.720", "00:01:25:12" (frames), "85.72s", "1234567t" (ticks)
function ttmlTime(v, tickRate, frameRate) {
  if (!v) return NaN;
  let m;
  if ((m = v.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/))) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +("0." + m[4]) : 0);
  if ((m = v.match(/^(\d+):(\d{2}):(\d{2}):(\d+)$/))) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / frameRate;
  if ((m = v.match(/^([\d.]+)(h|m|s|ms|t|f)$/))) {
    const n = +m[1];
    return { h: n * 3600, m: n * 60, s: n, ms: n / 1000, t: n / tickRate, f: n / frameRate }[m[2]];
  }
  return NaN;
}

export function parseTTML(xml) {
  const tickRate = +(xml.match(/tickRate="(\d+)"/)?.[1] ?? 10000000);
  const frameRate = +(xml.match(/frameRate="(\d+)"/)?.[1] ?? 30);
  const cues = [];
  for (const m of xml.matchAll(/<(?:tt:)?p\b([^>]*)>([\s\S]*?)<\/(?:tt:)?p>/g)) {
    const attrs = m[1];
    const start = ttmlTime(attrs.match(/\bbegin="([^"]+)"/)?.[1], tickRate, frameRate);
    let end = ttmlTime(attrs.match(/\bend="([^"]+)"/)?.[1], tickRate, frameRate);
    if (isNaN(end)) end = start + ttmlTime(attrs.match(/\bdur="([^"]+)"/)?.[1], tickRate, frameRate);
    const text = decode(m[2]);
    if (!isNaN(start) && !isNaN(end) && text) cues.push({ start, end, text });
  }
  return cues;
}

const vttTime = (v) => {
  const p = v.trim().split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};
export function parseVTT(vtt) {
  const cues = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex(l => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const text = decode(lines.slice(i + 1).join(" "));
    const start = vttTime(a), end = vttTime(b.trim().split(/\s/)[0]);
    if (!isNaN(start) && !isNaN(end) && text) cues.push({ start, end, text });
  }
  return cues;
}

export function looksLikeCaptions(text) {
  const head = text.slice(0, 2000);
  if (/^﻿?WEBVTT/.test(head)) return "vtt";
  if (/<(?:tt:)?tt[\s>]/.test(head) && /<(?:tt:)?p\b/.test(text)) return "ttml";
  return null;
}

export function profanitySegments(cues, offset = 0) {
  return cues.filter(c => PROFANITY.test(c.text)).map(c => ({
    start: Math.max(0, c.start + offset - 0.3), end: c.end + offset + 0.2,
    category: "profanity", severity: 2, source: "local",
  }));
}

// The caption file's clock and the player's clock can differ (intros, ad stitching,
// HLS timestamp maps). Measure it: for captions seen ON SCREEN at player time t, find
// the file cue with the same text, and take the median of (t - cue.start).
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
export function estimateOffset(screenCues, fileCues) {
  const byText = new Map();
  for (const c of fileCues) { const k = norm(c.text); if (k.length >= 8 && !byText.has(k)) byText.set(k, c); }
  const diffs = [];
  for (const s of screenCues) {
    const k = norm(s.text);
    let hit = byText.get(k);
    if (!hit) for (const [ft, c] of byText) if (ft.length >= 12 && (k.includes(ft) || ft.includes(k))) { hit = c; break; }
    if (hit) diffs.push(s.t - hit.start);
  }
  if (diffs.length < 3) return { offset: null, matches: diffs.length };
  diffs.sort((a, b) => a - b);
  const offset = diffs[Math.floor(diffs.length / 2)];
  // Agreement: how many matches sit within 1.5s of the median. Low agreement = repeated
  // lines matched the wrong cue; don't trust it.
  const agree = diffs.filter(d => Math.abs(d - offset) < 1.5).length / diffs.length;
  return { offset: agree >= 0.6 ? offset : null, matches: diffs.length, agree };
}

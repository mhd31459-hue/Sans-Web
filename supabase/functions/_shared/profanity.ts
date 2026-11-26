// Single source of truth for caption-based profanity segments (server-side; the
// extension no longer computes its own). Plain TypeScript with no TS-only syntax, so
// Node can run it directly in tests.
//
// WORD-LEVEL timing: a caption cue gives a start, an end, and the line. The word's
// time is estimated from its position in the SPOKEN part of the line, between a
// fast-speech and a whole-cue estimate, so "Get the fuck down, now!" shown 10–12s
// mutes ~10.0–11.3s instead of the whole 2s line.

// \w* on both sides of the strong roots catches compounds (bullshit, motherfucker);
// short words that are substrings of ordinary words keep strict boundaries.
export const PROFANITY_SRC =
  "\\b(\\w*fuck\\w*|\\w*shit\\w*|bitch\\w*|cunt\\w*|\\w*asshole\\w*|bastard\\w*|dick|dicks|cock|cocks|pussy|goddamn\\w*|damn|damned|damnit|" +
  // "ass" only as itself or in known compounds, never inside pass, class, bass, assess.
  "(?:jack|dumb|bad|smart|kick|wise|fat|lard|hard|tight|half-?|candy|dip|lame|sweet|kiss-?)?ass(?:es|ed)?)\\b";

// Strength tiers (1 mild, 2 moderate, 3 strong), so a profile can mute only the
// stronger words. Everything the pattern matches that isn't listed here is moderate.
export function wordSeverity(word: string): number {
  const w = word.toLowerCase();
  if (/fuck|cunt/.test(w)) return 3;
  if (/^(damn|damned|damnit)$/.test(w)) return 1;
  if (/ass(es|ed)?$/.test(w)) return 1;            // ass, jackass, half-assed (asshole stays moderate)
  return 2;
}

export type Cue = { t: number; end?: number; text: string };
export type Seg = { start: number; end: number; category: string; severity: number; source: string };

const PAD_BEFORE = 0.25;   // speech often leads the caption's character position
const PAD_AFTER = 0.25;
const MIN_MUTE = 0.6;      // never shorter than this — a clipped syllable still lands
// Captions stay on screen after the speech ends, so spreading the words across the whole
// cue places late words too LATE. Measured on a real leak: "It's kinda f— up." was shown
// for ~2s but spoken in 0.7s (~30 chars/s), and the mute began after the word ended.
// So the mute STARTS at the earlier of the proportional estimate and a fast-speech
// estimate, and ENDS at the proportional (slow) one: it covers the word at any pace.
const FAST_CPS = 28;

// Text that appears in captions but is not spoken: sound cues, music, speaker tags.
export function spokenText(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")             // [gunshot], [Disa]
    .replace(/\([^)]*\)/g, " ")              // (whispering)
    .replace(/[♪♫]+/g, " ")
    .replace(/\s+/g, " ").trim()            // trim BEFORE speaker tags, or "[x] NAME:" slips through
    .replace(/(^|-\s*)[A-Z][A-Z0-9 .'-]{1,24}:\s*/g, "$1")   // "SOLDIER: ", "- MAN 2: "
    .replace(/\s+/g, " ").trim();
}

// ── Blasphemy: God's or Jesus's name as an exclamation or oath ─────────────────
// Matched as PHRASES IN CONTEXT, never the bare word, so "God bless you", "Jesus said
// to them", "believe in God" or a character named Jesús are left alone. A name counts
// only where it's used as an interjection: at the start of a sentence (or after "oh",
// a dash, or a speaker change) AND followed by punctuation or the end of the line —
// "Jesus, what happened?", "God!", "Christ." — or inside a fixed oath like "for God's
// sake". Each phrase carries its strength (1 mild idiom, 2 exclamation, 3 strong oath).
//
// START: the name begins a sentence, follows "oh"/"sweet"/"holy"/"good", or a dash.
const START = "(?<=^|[.!?…]\\s*|[-—–]\\s*|\\boh,?\\s+|\\bsweet\\s+|\\bholy\\s+|\\bgood\\s+)";
// EXCL: what follows an interjection — punctuation or the end of the line.
const EXCL = "(?=\\s*(?:[,.!?…—–-]|$))";
export const BLASPHEMY: [RegExp, number][] = [
  // 3 — strong oaths
  [/\bgod[\s-]*damn\w*|\bgoddam\w*|\bgod[\s-]*dammit\b/gi, 3],
  [/\bjesus\s+(?:\w*fuck\w*|h\.?)\s+christ\b/gi, 3],
  // 2 — exclamations
  [/\boh,?\s+my\s+god\b/gi, 2],                                     // "Oh my God" in any position
  [new RegExp(`\\bmy\\s+god${EXCL}`, "gi"), 2],                   // "My God!" but not "my God is good"
  [/\boh,?\s+god\b/gi, 2],
  [new RegExp(`\\b(?:good|sweet|great)\\s+god${EXCL}`, "gi"), 2],
  [new RegExp(`\\b(?:god|lord)\\s+almighty${EXCL}`, "gi"), 2],
  [/\bfor\s+(?:god|christ|jesus|jesus\s+christ)'?s\s+sake\b/gi, 2],
  [/\bomg\b/gi, 2],
  [/\bchrist\s+almighty\b/gi, 2],
  [new RegExp(`${START}god${EXCL}`, "gi"), 2],                    // "God, I hate this." / "God!"
  [new RegExp(`${START}(?:jesus(?:\\s+christ)?|christ)${EXCL}`, "gi"), 2],   // "Jesus!", "Jesus Christ, man"
  // 1 — mild idioms
  [/\bthank\s+god\b/gi, 1],
  [/\bgod\s+(?:knows|forbid|help\s+(?:me|us|you|him|her|them))\b/gi, 1],
  [/\b(?:swear|hand)\s+to\s+(?:god|christ)\b|\bhonest\s+to\s+god\b/gi, 1],
  [new RegExp(`\\b(?:oh|good|sweet)\\s+lord${EXCL}`, "gi"), 1],
  // Hell as a curse or an intensifier, not the place ("believe in hell", "heaven and hell").
  [/\b(?:go|goes|going|went|gone)\s+to\s+hell\b|\b(?:burn|rot|see\s+you)\s+in\s+hell\b|\bto\s+hell\s+with\b|\bdamn\w*\s+(?:\w+\s+)?to\s+hell\b/gi, 2],
  [/\b(?:the|a|one|as|like|from|all|bloody)\s+hell\b(?!'s\s+kitchen)/gi, 1],   // what the hell, a hell of, cold as hell
  [/\bhell\s+(?:yeah|yes|no|of\s+a)\b/gi, 1],
  [new RegExp(`${START}hell${EXCL}`, "gi"), 1],                   // "Hell!" / "Hell, I don't know."
];

type Hit = { i: number; len: number; severity: number; category: string };

// Every blasphemous phrase in a line, overlaps resolved: "Oh my God" is one phrase,
// not also "my God" and "oh God"; the stronger (then longer) match wins.
export function blasphemyHits(spoken: string): Hit[] {
  const all: Hit[] = [];
  for (const [re, severity] of BLASPHEMY)
    for (const m of spoken.matchAll(re)) all.push({ i: m.index ?? 0, len: m[0].length, severity, category: "blasphemy" });
  all.sort((a, b) => b.severity - a.severity || b.len - a.len);
  const kept: Hit[] = [];
  for (const h of all)
    if (!kept.some(k => h.i < k.i + k.len && k.i < h.i + h.len)) kept.push(h);
  return kept.sort((a, b) => a.i - b.i);
}

function profanityHits(spoken: string): Hit[] {
  return [...spoken.matchAll(new RegExp(PROFANITY_SRC, "gi"))]
    .map(m => ({ i: m.index ?? 0, len: m[0].length, severity: wordSeverity(m[0]), category: "profanity" }));
}

// Turns matches in one cue into timed segments (word-level timing, see the top).
function timedSegments(c: Cue, nextT: number | undefined, find: (spoken: string) => Hit[]): Seg[] {
  const spoken = spokenText(c.text);
  if (!spoken) return [];
  // Cues read off the screen have no end time; fall back to the next cue, capped.
  const end = c.end ?? Math.min(nextT ?? c.t + 3, c.t + 4);
  const dur = Math.min(Math.max(end - c.t, 0.5), 8);
  const n = spoken.length;
  const out: Seg[] = [];
  for (const h of find(spoken)) {
    let s = c.t + Math.min(dur * (h.i / n), h.i / FAST_CPS) - PAD_BEFORE;
    let e = c.t + dur * ((h.i + h.len) / n) + PAD_AFTER;
    if (e - s < MIN_MUTE) { const mid = (s + e) / 2; s = mid - MIN_MUTE / 2; e = mid + MIN_MUTE / 2; }
    s = Math.max(0, Math.max(s, c.t - 0.3));
    e = Math.min(e, end + 0.2);
    const last = out[out.length - 1];
    // Adjacent matches in one line share a mute only when they're the same strength;
    // otherwise "damn, f—" would mute the mild word for a strong-only profile.
    if (last && s <= last.end && last.severity === h.severity) last.end = Math.max(last.end, e);
    else out.push({ start: +s.toFixed(2), end: +e.toFixed(2), category: h.category, severity: h.severity, source: "captions" });
  }
  for (const o of out) o.end = +o.end.toFixed(2);
  return out;
}

export const profanityForCue = (c: Cue, nextT?: number): Seg[] => timedSegments(c, nextT, profanityHits);
export const blasphemyForCue = (c: Cue, nextT?: number): Seg[] => timedSegments(c, nextT, blasphemyHits);

// Both word lists, from the subtitles: swears ("profanity") and God's name ("blasphemy").
export function profanitySegments(cues: Cue[]): Seg[] {
  return cues.flatMap((c, i) => [...profanityForCue(c, cues[i + 1]?.t), ...blasphemyForCue(c, cues[i + 1]?.t)]);
}

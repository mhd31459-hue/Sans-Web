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
  "\\b(\\w*fuck\\w*|\\w*shit\\w*|bitch\\w*|cunt\\w*|\\w*asshole\\w*|bastard\\w*|dick|dicks|cock|cocks|pussy|goddamn\\w*|damn|damned|damnit)\\b";

// Strength tiers (1 mild, 2 moderate, 3 strong), so a profile can mute only the
// stronger words. Everything the pattern matches that isn't listed here is moderate.
export function wordSeverity(word: string): number {
  const w = word.toLowerCase();
  if (/fuck|cunt/.test(w)) return 3;
  if (/^(damn|damned|damnit)$/.test(w)) return 1;
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

export function profanityForCue(c: Cue, nextT?: number): Seg[] {
  const spoken = spokenText(c.text);
  if (!spoken) return [];
  // Cues read off the screen have no end time; fall back to the next cue, capped.
  const end = c.end ?? Math.min(nextT ?? c.t + 3, c.t + 4);
  const dur = Math.min(Math.max(end - c.t, 0.5), 8);
  const n = spoken.length;
  const out: Seg[] = [];
  for (const m of spoken.matchAll(new RegExp(PROFANITY_SRC, "gi"))) {
    const i = m.index ?? 0;
    let s = c.t + Math.min(dur * (i / n), i / FAST_CPS) - PAD_BEFORE;
    let e = c.t + dur * ((i + m[0].length) / n) + PAD_AFTER;
    if (e - s < MIN_MUTE) { const mid = (s + e) / 2; s = mid - MIN_MUTE / 2; e = mid + MIN_MUTE / 2; }
    s = Math.max(0, Math.max(s, c.t - 0.3));
    e = Math.min(e, end + 0.2);
    const sev = wordSeverity(m[0]);
    const last = out[out.length - 1];
    // Adjacent swears in one line share a mute only when they're the same strength;
    // otherwise "damn, f—" would mute the mild word for a strong-only profile.
    if (last && s <= last.end && last.severity === sev) last.end = Math.max(last.end, e);
    else out.push({ start: +s.toFixed(2), end: +e.toFixed(2), category: "profanity", severity: sev, source: "captions" });
  }
  for (const o of out) o.end = +o.end.toFixed(2);
  return out;
}

export function profanitySegments(cues: Cue[]): Seg[] {
  return cues.flatMap((c, i) => profanityForCue(c, cues[i + 1]?.t));
}

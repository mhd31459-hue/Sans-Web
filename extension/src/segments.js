// Pure decision logic: given the playhead, a map, and the viewer's preferences,
// what should the player do right now? No DOM here so it can be tested in Node.
//
// segment: { start, end, category, severity }   (seconds; category in CATEGORIES)
// prefs:   { [category]: "off" | "mute" | "cover" | "skip" }
export const CATEGORIES = ["profanity", "nudity", "sex", "violence"];
export const DEFAULT_PREFS = { profanity: "mute", nudity: "skip", sex: "skip", violence: "skip" };

export function decide(t, segments, prefs = DEFAULT_PREFS) {
  let mute = false, cover = false, skipTo = null;
  for (const s of segments) {
    if (t < s.start || t >= s.end) continue;
    const action = prefs[s.category] ?? "off";
    if (action === "mute") mute = true;
    else if (action === "cover") { cover = true; mute = true; }   // covering also mutes: a hidden scene with audible sex/violence isn't filtered
    else if (action === "skip") skipTo = Math.max(skipTo ?? 0, s.end);
  }
  // Chained skips: landing inside another skip segment should keep going.
  if (skipTo !== null) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const s of segments) {
        if ((prefs[s.category] ?? "off") === "skip" && skipTo >= s.start && skipTo < s.end) {
          skipTo = s.end; moved = true;
        }
      }
    }
  }
  return { mute, cover, skipTo };
}

// Merge overlapping/adjacent segments of the same category (AI drafts often fragment).
export function normalize(segments, gap = 1.0) {
  const out = [];
  const sorted = [...segments].filter(s => s.end > s.start).sort((a, b) => a.category.localeCompare(b.category) || a.start - b.start);
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.category === s.category && s.start <= last.end + gap) {
      last.end = Math.max(last.end, s.end);
      last.severity = Math.max(last.severity ?? 1, s.severity ?? 1);
    } else out.push({ ...s });
  }
  return out.sort((a, b) => a.start - b.start);
}

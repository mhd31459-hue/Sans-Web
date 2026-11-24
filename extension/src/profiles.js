// Filter profiles: who's watching decides what gets filtered and how strongly.
// Pure data, no DOM or chrome.* — shared by the player, the popup, and (as a copy in
// docs/profiles.js, kept identical by a test) the website.
//
// settings = { profanity: { action, min }, nudity: {…}, sex: {…}, violence: {…}, confirmedOnly }
//   action: "off" | "mute" | "cover" | "skip"
//   min:    weakest strength filtered: 1 = mild and up, 2 = moderate and up, 3 = strong only
//   confirmedOnly: ignore drafts nobody has reviewed yet (word-list swears still count)
export const CATEGORIES = ["profanity", "nudity", "sex", "violence"];
export const LABELS = { profanity: "Language", nudity: "Nudity", sex: "Sex", violence: "Violence" };
export const STRENGTH = { 1: "Mild", 2: "Moderate", 3: "Strong" };
export const ACTIONS = {
  profanity: ["off", "mute"],
  nudity: ["off", "mute", "cover", "skip"],
  sex: ["off", "mute", "cover", "skip"],
  violence: ["off", "mute", "cover", "skip"],
};

// What each strength means, shown next to the setting and used to rate scenes.
export const RUBRIC = {
  profanity: { 1: "damn", 2: "sh*t, b*tch, a**hole, bastard, d*ck, goddamn", 3: "f-word, c-word" },
  nudity:    { 1: "brief or partial, non-sexual", 2: "clear nudity", 3: "prolonged or full-frontal" },
  sex:       { 1: "kissing in bed, implied, cut away", 2: "sex scene, no explicit nudity", 3: "explicit sex scene" },
  violence:  { 1: "fighting, peril, little blood", 2: "shootings, blood, injury", 3: "gore, torture, brutal deaths" },
};

const rule = (action, min) => ({ action, min });
export const PRESETS = {
  kids: {
    label: "Kids",
    settings: { profanity: rule("mute", 1), nudity: rule("skip", 1), sex: rule("skip", 1), violence: rule("skip", 1), confirmedOnly: false },
  },
  teens: {
    label: "Teens",
    settings: { profanity: rule("mute", 2), nudity: rule("skip", 1), sex: rule("skip", 1), violence: rule("skip", 2), confirmedOnly: false },
  },
  adults: {
    label: "Adults",
    settings: { profanity: rule("mute", 3), nudity: rule("skip", 2), sex: rule("skip", 2), violence: rule("skip", 3), confirmedOnly: false },
  },
};
export const DEFAULT_SETTINGS = PRESETS.kids.settings;

const uuid = () => globalThis.crypto.randomUUID();
export const newProfile = (name = "Me", settings = DEFAULT_SETTINGS) =>
  ({ id: uuid(), name, settings: clean(settings) });

// Coerce anything (old prefs, a hand-edited or partial object) into valid settings.
// Old prefs looked like { profanity: "mute", violence: "skip" }: kept, at min 1.
export function clean(s) {
  const out = { confirmedOnly: !!s?.confirmedOnly };
  for (const c of CATEGORIES) {
    const v = s?.[c];
    const action = typeof v === "string" ? v : v?.action;
    const min = typeof v === "object" ? +v?.min : 1;
    out[c] = {
      action: ACTIONS[c].includes(action) ? action : DEFAULT_SETTINGS[c].action,
      min: [1, 2, 3].includes(min) ? min : 1,
    };
  }
  return out;
}

// Which preset these settings match, or null for custom.
export const presetOf = (s) =>
  Object.keys(PRESETS).find(k => JSON.stringify(clean(PRESETS[k].settings)) === JSON.stringify(clean(s))) ?? null;

// Does this segment get filtered for this profile?
export function applies(seg, settings) {
  const r = settings?.[seg.category];
  if (!r || r.action === "off") return false;
  if ((seg.severity ?? 2) < (r.min ?? 1)) return false;
  // Caption swears come straight from the subtitle text, and the viewer's own report
  // is theirs, so neither waits for review.
  if (settings.confirmedOnly && seg.status !== "confirmed" && seg.source !== "captions" && !seg.mine) return false;
  return true;
}

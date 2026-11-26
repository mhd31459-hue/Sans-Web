// Filter profiles: who's watching decides what gets filtered and how strongly.
// Pure data, no DOM or chrome.* — shared by the player, the popup, and (as a copy in
// docs/profiles.js, kept identical by a test) the website.
//
// settings = { profanity: { action, min }, blasphemy: {…}, nudity: {…}, sex: {…}, violence: {…}, confirmedOnly }
//   action: "off" | "mute" | "cover" | "skip"
//   min:    weakest strength filtered: 1 = mild and up, 2 = moderate and up, 3 = strong only
//   confirmedOnly: ignore drafts nobody has reviewed yet (word-list swears still count)
export const CATEGORIES = ["profanity", "blasphemy", "nudity", "sex", "violence"];
export const LABELS = { profanity: "Language", blasphemy: "Blasphemy", nudity: "Nudity", sex: "Sex", violence: "Violence" };
export const STRENGTH = { 1: "Mild", 2: "Moderate", 3: "Strong" };
export const ACTIONS = {
  profanity: ["off", "mute"],
  blasphemy: ["off", "mute"],
  nudity: ["off", "mute", "cover", "skip"],
  sex: ["off", "mute", "cover", "skip"],
  violence: ["off", "mute", "cover", "skip"],
};

// What each strength means, shown next to the setting and used to rate scenes.
export const RUBRIC = {
  profanity: { 1: "damn, ass", 2: "sh*t, b*tch, a**hole, bastard, d*ck, goddamn", 3: "f-word, c-word" },
  blasphemy: { 1: "what the hell, thank God, God knows, swear to God", 2: "oh my God, Jesus!, Jesus Christ!, go to hell", 3: "goddamn, Jesus H. Christ" },
  nudity:    { 1: "brief or partial, non-sexual", 2: "clear nudity", 3: "prolonged or full-frontal" },
  sex:       { 1: "kissing in bed, implied, cut away", 2: "sex scene, no explicit nudity", 3: "explicit sex scene" },
  violence:  { 1: "fighting, peril, little blood", 2: "shootings, blood, injury", 3: "gore, torture, brutal deaths" },
};

const rule = (action, min) => ({ action, min });
export const PRESETS = {
  kids: {
    label: "Kids",
    settings: { profanity: rule("mute", 1), blasphemy: rule("mute", 1), nudity: rule("skip", 1), sex: rule("skip", 1), violence: rule("skip", 1), confirmedOnly: false },
  },
  teens: {
    label: "Teens",
    settings: { profanity: rule("mute", 2), blasphemy: rule("mute", 2), nudity: rule("skip", 1), sex: rule("skip", 1), violence: rule("skip", 2), confirmedOnly: false },
  },
  adults: {
    label: "Adults",
    settings: { profanity: rule("mute", 3), blasphemy: rule("off", 1), nudity: rule("skip", 2), sex: rule("skip", 2), violence: rule("skip", 3), confirmedOnly: false },
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
    if (c === "blasphemy" && s?.blasphemy == null) continue;   // filled in below
    const v = s?.[c];
    const action = typeof v === "string" ? v : v?.action;
    const min = typeof v === "object" ? +v?.min : 1;
    out[c] = {
      action: ACTIONS[c].includes(action) ? action : DEFAULT_SETTINGS[c].action,
      min: [1, 2, 3].includes(min) ? min : 1,
    };
  }
  // Profiles saved before blasphemy existed: take it from the preset they match, else
  // follow their language rule (filtered language → God's name muted at the same strength).
  if (!out.blasphemy) {
    const old = ["profanity", "nudity", "sex", "violence"];
    const key = (x) => JSON.stringify(old.map(c => [x[c].action, x[c].min]));
    const match = Object.values(PRESETS).find(p => key(p.settings) === key(out));
    out.blasphemy = match ? { ...match.settings.blasphemy }
      : out.profanity.action === "off" ? { action: "off", min: 1 } : { action: "mute", min: out.profanity.min };
  }
  return Object.fromEntries([...CATEGORIES, "confirmedOnly"].map(k => [k, out[k]]));
}

// Which preset these settings match (ignoring "confirmed only"), or null for custom.
const rulesKey = (s) => JSON.stringify(CATEGORIES.map(c => clean(s)[c]));
export const presetOf = (s) => Object.keys(PRESETS).find(k => rulesKey(PRESETS[k].settings) === rulesKey(s)) ?? null;

// A preset's rules, keeping the profile's own "confirmed only" choice.
export const withPreset = (s, key) => ({ ...clean(PRESETS[key].settings), confirmedOnly: !!s?.confirmedOnly });

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

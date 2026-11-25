// "Missed one" hotkey: Alt+M (Option+M on a Mac) opens a small picker over the player.
//   1–5 picks what slipped through, then 1–3 how strong it was (Enter or a pause = moderate).
//   6 (offered right after Sans filtered something) rates THAT: 1–3, or 0 = shouldn't be filtered.
// A report is applied at once (so a scene still playing is skipped now) and sent to the
// server as a draft for others to tighten. Plain DOM, no service-specific code, so it
// ports to Firefox and Safari unchanged.
import { LABELS, RUBRIC, STRENGTH } from "./profiles.js";

// Seconds [before, after] the key press. Must match supabase/functions/report/index.ts.
export const REPORT_WINDOW = {
  profanity: [8, 1], blasphemy: [8, 1], nudity: [20, 10], sex: [20, 10], violence: [20, 10],
};
const CATS = ["violence", "sex", "nudity", "profanity", "blasphemy"];   // keys 1–5
const VERB = { mute: "muted", cover: "covered", skip: "skipped" };
export const reportSegment = (t, category, severity = 2) => ({
  start: Math.max(0, +(t - REPORT_WINDOW[category][0]).toFixed(2)),
  end: +(t + REPORT_WINDOW[category][1]).toFixed(2),
  category, severity, source: "report", mine: true,
});

export const isReportHotkey = (e) => e.code === "KeyM" && e.altKey && !e.ctrlKey && !e.metaKey;

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
};

// Shown in the browser's TOP LAYER (popover) where supported: above the player, its
// controls and full screen, whatever their stacking. Attaching inside the player's own
// container (v0.4.0) left the box clipped or buried there.
function mount(el) {
  const fs = document.fullscreenElement;
  if (el.showPopover) {
    el.popover = "manual";
    document.body.append(el);
    try { el.showPopover(); return; } catch { el.remove(); el.removeAttribute("popover"); }
  }
  (fs && fs.tagName !== "VIDEO" ? fs : document.body).append(el);
}
const BOX = "position:fixed;left:50%;bottom:12%;top:auto;right:auto;margin:0;transform:translateX(-50%);z-index:2147483647;" +
  "background:#121212;color:#e1e1e1;border:1px solid #e0ff00;border-radius:12px;padding:14px 18px;" +
  "font:14px/1.5 ui-monospace,'SF Mono',Menlo,monospace;box-shadow:0 8px 30px #000a;max-width:90vw";

// onReport(category, severity) and onRate(recent, severity 0–3) are the two outcomes.
// recent() returns what Sans most recently filtered ({ category, action, start, end })
// if it was in the last few seconds, else null. Returns toggle(), which the
// browser-level shortcut (background.js → message) also calls, because a player can
// swallow keys before a page listener sees them.
export function installReportHotkey({ onReport, onRate, recent = () => null }) {
  let picker = null, timer = 0, lastToggle = 0, keys = [];

  const close = () => { picker?.remove(); picker = null; clearTimeout(timer); keys = []; };

  // One screen of the picker: a title, numbered choices, a hint. choices: [key, label, fn]
  const show = (heading, choices, hint, { autoKey = null, ms = 10000 } = {}) => {
    close();
    picker = document.createElement("div");
    picker.style.cssText = BOX;
    const title = document.createElement("div");
    title.textContent = heading;
    title.style.cssText = "color:#e0ff00;font-weight:700;letter-spacing:.08em;margin-bottom:8px";
    picker.append(title);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    for (const [key, label, fn, sub] of choices) {
      const b = document.createElement("button");
      b.textContent = `${key} ${label}`;
      if (sub) b.title = sub;
      b.style.cssText = "font:inherit;background:#1c1c1c;color:#e1e1e1;border:1px solid #2e2e2e;" +
        "border-radius:8px;padding:6px 10px;cursor:pointer";
      b.onclick = (ev) => { ev.stopPropagation(); close(); fn(); };
      row.append(b);
    }
    picker.append(row);
    // What each strength means, so ratings mean the same thing from viewer to viewer.
    const defs = choices.filter(c => c[3]);
    if (defs.length) {
      const d = document.createElement("div");
      d.style.cssText = "color:#b3b3b3;font-size:12px;margin-top:8px;line-height:1.6";
      for (const [key, , , sub] of defs) {
        const line = document.createElement("div");
        line.textContent = `${key} = ${sub}`;
        d.append(line);
      }
      picker.append(d);
    }
    const h = document.createElement("div");
    h.textContent = hint;
    h.style.cssText = "color:#6b6b6b;font-size:12px;margin-top:8px";
    picker.append(h);
    keys = choices.map(([key, , fn]) => [String(key), fn]);
    if (autoKey) keys.push(["Enter", keys.find(([k]) => k === autoKey)[1]]);
    mount(picker);
    const auto = autoKey && keys.find(([k]) => k === autoKey)[1];
    timer = setTimeout(() => { close(); auto?.(); }, ms);
  };

  const strength = (category) => show(
    `SANS · how strong was the ${LABELS[category].toLowerCase()}?`,
    [1, 2, 3].map(n => [n, STRENGTH[n], () => onReport(category, n), RUBRIC[category][n]]),
    "Enter = moderate · sends as moderate in 5s · Esc cancels",
    { autoKey: "2", ms: 5000 });

  const rateIt = (r) => show(
    `SANS · rate the ${LABELS[r.category].toLowerCase()} it ${VERB[r.action] ?? "filtered"} (${fmt(r.start)}–${fmt(r.end)})`,
    [...[1, 2, 3].map(n => [n, STRENGTH[n], () => onRate(r, n), RUBRIC[r.category][n]]),
     [0, "Shouldn't be filtered", () => onRate(r, 0)]],
    "Esc to cancel");

  const open = () => {
    const r = recent();
    show("SANS · missed something?",
      [...CATS.map((c, i) => [i + 1, LABELS[c], () => strength(c)]),
       ...(r ? [[6, `Rate the ${LABELS[r.category].toLowerCase()} it just ${VERB[r.action] ?? "filtered"}`, () => rateIt(r)]] : [])],
      "Esc to cancel");
  };

  // Both the page key listener and the browser shortcut may fire for one press.
  const toggle = () => {
    if (Date.now() - lastToggle < 400) return;
    lastToggle = Date.now();
    picker ? close() : open();
  };

  // Capture phase on window: runs before most of the player's own shortcuts.
  window.addEventListener("keydown", (e) => {
    if (isReportHotkey(e)) {
      e.preventDefault(); e.stopImmediatePropagation();
      toggle();
      return;
    }
    if (!picker) return;
    const k = /^(Digit|Numpad)\d$/.test(e.code) ? e.code.slice(-1) : e.key === "Enter" ? "Enter" : null;
    const hit = keys.find(([key]) => key === k);
    if (hit || e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); }
    if (hit) { const fn = hit[1]; close(); fn(); } else if (e.key === "Escape") close();
  }, true);
  return { toggle };
}

export function toast(text, ms = 3500) {
  const el = document.createElement("div");
  el.style.cssText = BOX;
  el.textContent = text;
  mount(el);
  setTimeout(() => el.remove(), ms);
}

export { fmt };

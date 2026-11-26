// "Missed one" hotkey: Alt+M (Option+M on a Mac) opens a small picker over the player.
//   1–5 picks what slipped through, then 1–3 how strong it was (Enter or a pause = moderate).
//   For Language and Blasphemy the video PAUSES and the last few subtitle lines are shown
//   word by word: pick the word (arrows + Enter, or click) and only that word is muted.
//   With no subtitles caught, pick roughly when it was said instead.
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
export const reportSegment = (t, category, severity = 2, span = null) => ({
  start: Math.max(0, +(span ? span.start : t - REPORT_WINDOW[category][0]).toFixed(2)),
  end: +(span ? span.end : t + REPORT_WINDOW[category][1]).toFixed(2),
  category, severity, source: "report", mine: true,
});

// Words people actually hear: drop sound cues, music and speaker tags (as the server does).
export function spoken(text) {
  return text.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/[♪♫]+/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/(^|-\s*)[A-Z][A-Z0-9 .'-]{1,24}:\s*/g, "$1").replace(/\s+/g, " ").trim();
}

// When a word in a subtitle line was said, estimated from its position in the line.
// Same model as the server's word list (supabase/functions/_shared/profanity.ts): speech
// runs ahead of the caption, so start at the earlier of the proportional and a fast-speech
// estimate, end at the proportional one, padded, never shorter than 0.8 s.
export function wordSpan(line, charIndex, length) {
  const n = Math.max(1, spoken(line.text).length);
  const dur = Math.min(Math.max(line.end - line.start, 0.5), 8);
  let s = line.start + Math.min(dur * (charIndex / n), charIndex / 28) - 0.3;
  let e = line.start + dur * ((charIndex + length) / n) + 0.3;
  if (e - s < 0.8) { const mid = (s + e) / 2; s = mid - 0.4; e = mid + 0.4; }
  s = Math.max(0, s, line.start - 0.3);
  e = Math.min(e, line.end + 0.3);
  return { start: +s.toFixed(2), end: +e.toFixed(2) };
}
const WORDS = new Set(["profanity", "blasphemy"]);

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

// onReport(category, severity, span?) and onRate(recent, severity 0–3) are the outcomes;
// span = { start, end } when the viewer picked the exact word or moment.
// recent() returns what Sans most recently filtered ({ category, action, start, end })
// if it was in the last few seconds, else null. lines() returns the last few subtitle
// lines on the player's clock ({ start, end, text }); hold() pauses the video and returns
// a function that resumes it (if it was playing). Returns toggle(), which the
// browser-level shortcut (background.js → message) also calls, because a player can
// swallow keys before a page listener sees them.
export function installReportHotkey({ onReport, onRate, recent = () => null, lines = () => [], hold = () => () => {}, now = () => 0 }) {
  let picker = null, timer = 0, lastToggle = 0, keys = [], onKey = null, resume = null;

  const close = () => { picker?.remove(); picker = null; clearTimeout(timer); keys = []; onKey = null; };
  // Leave the picker for good: close it and let the video play again if we paused it.
  const finish = () => { close(); const r = resume; resume = null; r?.(); };

  // One screen of the picker: a title, numbered choices, a hint. choices: [key, label, fn]
  // body: extra content above the hint; key: a handler for other keys (arrows).
  const show = (heading, choices, hint, { autoKey = null, ms = 10000, body = null, key = null, onTimeout = null } = {}) => {
    close();
    picker = document.createElement("div");
    picker.style.cssText = BOX;
    const title = document.createElement("div");
    title.textContent = heading;
    title.style.cssText = "color:#e0ff00;font-weight:700;letter-spacing:.08em;margin-bottom:8px";
    picker.append(title);
    if (body) picker.append(body);
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
    onKey = key;
    mount(picker);
    const auto = autoKey && keys.find(([k]) => k === autoKey)[1];
    timer = setTimeout(() => { if (auto) { close(); auto(); } else (onTimeout ?? finish)(); }, ms);
  };

  const strength = (category, span = null) => show(
    `SANS · how strong was the ${LABELS[category].toLowerCase()}?`,
    [1, 2, 3].map(n => [n, STRENGTH[n], () => { onReport(category, n, span); finish(); }, RUBRIC[category][n]]),
    "Enter = moderate · sends as moderate in 5s · Esc cancels",
    { autoKey: "2", ms: 5000 });

  // Language and blasphemy: pause, show the recent subtitle lines, pick the word.
  const pickWord = (category) => {
    resume ??= hold();
    const ls = lines().map(l => ({ ...l, words: [...spoken(l.text).matchAll(/\S+/g)].map(m => ({ w: m[0], i: m.index })) }))
      .filter(l => l.words.length);
    if (!ls.length) return pickMoment(category);
    const t = now();
    let li = Math.max(0, ls.findLastIndex(l => l.start <= t + 0.2)), wi = 0;
    const body = document.createElement("div");
    body.style.cssText = "max-height:40vh;overflow:auto;margin:2px 0 4px";
    const pick = () => strength(category, wordSpan(ls[li], ls[li].words[wi].i, ls[li].words[wi].w.length));
    const draw = () => {
      body.textContent = "";
      ls.forEach((l, a) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:10px;align-items:baseline;padding:2px 0";
        const when = document.createElement("span");
        when.textContent = fmt(l.start);
        when.style.cssText = "color:#6b6b6b;font-size:12px;min-width:44px";
        const words = document.createElement("span");
        words.style.cssText = "display:flex;flex-wrap:wrap;gap:2px 6px";
        l.words.forEach((x, b) => {
          const on = a === li && b === wi;
          const el = document.createElement("span");
          el.textContent = x.w;
          el.style.cssText = `cursor:pointer;border-radius:4px;padding:0 3px;${on ? "background:#e0ff00;color:#000" : ""}`;
          el.onclick = (ev) => { ev.stopPropagation(); li = a; wi = b; pick(); };
          words.append(el);
        });
        row.append(when, words);
        body.append(row);
      });
      const sp = wordSpan(ls[li], ls[li].words[wi].i, ls[li].words[wi].w.length);
      info.textContent = `Mutes about ${fmt(sp.start)}–${fmt(sp.end)} (${(sp.end - sp.start).toFixed(1)} s)`;
    };
    const info = document.createElement("div");
    info.style.cssText = "color:#b3b3b3;font-size:12px;margin-top:6px";
    const wrap = document.createElement("div");
    wrap.append(body, info);
    show(`SANS · paused · which word was it?`, [], "←/→ word · ↑/↓ line · Enter or click to choose · Esc cancels",
      { body: wrap, ms: 120000, key: (k) => {
        if (k === "ArrowLeft") { if (wi > 0) wi--; else if (li > 0) { li--; wi = ls[li].words.length - 1; } }
        else if (k === "ArrowRight") { if (wi < ls[li].words.length - 1) wi++; else if (li < ls.length - 1) { li++; wi = 0; } }
        else if (k === "ArrowUp") { if (li > 0) { li--; wi = Math.min(wi, ls[li].words.length - 1); } }
        else if (k === "ArrowDown") { if (li < ls.length - 1) { li++; wi = Math.min(wi, ls[li].words.length - 1); } }
        else if (k === "Enter") { pick(); return true; }
        else return false;
        draw(); return true;
      } });
    draw();
  };

  // No subtitles caught: choose roughly when it was said; about 3.5 s around that moment.
  const pickMoment = (category) => {
    resume ??= hold();
    const t = now();
    const ago = [12, 9, 6, 3, 0];
    show(`SANS · paused · about when was it said?`,
      ago.map((a, i) => [i + 1, a ? `~${a}s ago` : "just now",
        () => strength(category, { start: Math.max(0, +(t - a - 2).toFixed(2)), end: +(t - a + 1.5).toFixed(2) })]),
      "Turn subtitles on to pick the exact word · Esc cancels", { ms: 120000 });
  };

  const rateIt = (r) => show(
    `SANS · rate the ${LABELS[r.category].toLowerCase()} it ${VERB[r.action] ?? "filtered"} (${fmt(r.start)}–${fmt(r.end)})`,
    [...[1, 2, 3].map(n => [n, STRENGTH[n], () => { onRate(r, n); finish(); }, RUBRIC[r.category][n]]),
     [0, "Shouldn't be filtered", () => { onRate(r, 0); finish(); }]],
    "Esc to cancel");

  const open = () => {
    const r = recent();
    show("SANS · missed something?",
      [...CATS.map((c, i) => [i + 1, LABELS[c], () => WORDS.has(c) ? pickWord(c) : strength(c)]),
       ...(r ? [[6, `Rate the ${LABELS[r.category].toLowerCase()} it just ${VERB[r.action] ?? "filtered"}`, () => rateIt(r)]] : [])],
      "Esc to cancel");
  };

  // Both the page key listener and the browser shortcut may fire for one press.
  const toggle = () => {
    if (Date.now() - lastToggle < 400) return;
    lastToggle = Date.now();
    picker ? finish() : open();
  };

  // Capture phase on window: runs before most of the player's own shortcuts.
  window.addEventListener("keydown", (e) => {
    if (isReportHotkey(e)) {
      e.preventDefault(); e.stopImmediatePropagation();
      toggle();
      return;
    }
    if (!picker) return;
    // Screens with their own keys (the word list) see arrows and Enter first, and while
    // the picker is open no key reaches the player (its arrows would seek).
    if (onKey && onKey(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const k = /^(Digit|Numpad)\d$/.test(e.code) ? e.code.slice(-1) : e.key === "Enter" ? "Enter" : null;
    const hit = keys.find(([key]) => key === k);
    if (hit || e.key === "Escape" || /^(Arrow|Space$| $)/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
    if (hit) { const fn = hit[1]; close(); fn(); } else if (e.key === "Escape") finish();
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

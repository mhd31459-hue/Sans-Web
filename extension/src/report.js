// "Missed one" hotkey: Alt+M (Option+M on a Mac) opens a small picker over the player;
// 1–4 picks what slipped through. The report is applied at once (so a scene that's still
// playing gets skipped now) and sent to the server as a draft for others to tighten.
// Plain DOM, no service-specific code, so it ports to Firefox and Safari unchanged.

// Seconds [before, after] the key press. Must match supabase/functions/report/index.ts.
export const REPORT_WINDOW = {
  profanity: [8, 1], nudity: [20, 10], sex: [20, 10], violence: [20, 10],
};
const CHOICES = [["Digit1", "violence"], ["Digit2", "sex"], ["Digit3", "nudity"], ["Digit4", "profanity"]];
const LABEL = { violence: "Violence", sex: "Sex", nudity: "Nudity", profanity: "Language" };

export const reportSegment = (t, category) => ({
  start: Math.max(0, +(t - REPORT_WINDOW[category][0]).toFixed(2)),
  end: +(t + REPORT_WINDOW[category][1]).toFixed(2),
  category, severity: 2, source: "report",
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

// onPick(category) is called with the chosen category. Returns toggle(), which the
// browser-level shortcut (background.js → message) also calls, because a player can
// swallow keys before a page listener sees them.
export function installReportHotkey({ onPick }) {
  let picker = null, timer = 0, lastToggle = 0;

  const close = () => { picker?.remove(); picker = null; clearTimeout(timer); };
  const open = () => {
    close();
    picker = document.createElement("div");
    picker.style.cssText = BOX;
    const title = document.createElement("div");
    title.textContent = "SANS · missed something?";
    title.style.cssText = "color:#e0ff00;font-weight:700;letter-spacing:.08em;margin-bottom:8px";
    picker.append(title);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    CHOICES.forEach(([, cat], i) => {
      const b = document.createElement("button");
      b.textContent = `${i + 1} ${LABEL[cat]}`;
      b.style.cssText = "font:inherit;background:#1c1c1c;color:#e1e1e1;border:1px solid #2e2e2e;" +
        "border-radius:8px;padding:6px 10px;cursor:pointer";
      b.onclick = (ev) => { ev.stopPropagation(); close(); onPick(cat); };
      row.append(b);
    });
    picker.append(row);
    const hint = document.createElement("div");
    hint.textContent = "Esc to cancel";
    hint.style.cssText = "color:#6b6b6b;font-size:12px;margin-top:8px";
    picker.append(hint);
    mount(picker);
    timer = setTimeout(close, 10000);
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
    const choice = CHOICES.find(([code]) => e.code === code || e.code === code.replace("Digit", "Numpad"));
    if (choice || e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); }
    if (choice) { close(); onPick(choice[1]); } else if (e.key === "Escape") close();
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

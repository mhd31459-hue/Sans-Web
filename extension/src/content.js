// Content script: finds the service's own <video>, fetches the community map for this
// title, and applies it by MUTING, SEEKING, or COVERING the player — the same controls
// a viewer has. It never reads, captures, copies, or decrypts the video.
import { decide, DEFAULT_PREFS, normalize } from "./segments.js";
import { prime } from "./adapters/prime.js";
import { disney } from "./adapters/disney.js";
import { API } from "./config.js";

const adapter = [prime, disney].find(a => a.matches(location));
const state = { segments: [], prefs: DEFAULT_PREFS, cues: [], titleId: null, cover: null, weMuted: false };
window.__sansDebug = state;

function mainVideo() {
  // Services often keep several <video> elements (trailers, ads). Use the largest playing one.
  return [...document.querySelectorAll("video")]
    .filter(v => v.readyState > 0)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
}

function ensureCover() {
  if (state.cover?.isConnected) return state.cover;
  const host = adapter.playerContainer() || document.body;
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;inset:0;background:#000;z-index:2147483646;display:none;" +
    "align-items:center;justify-content:center;color:#888;font:14px system-ui;pointer-events:none";
  el.textContent = "Filtered";
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(el);
  return (state.cover = el);
}

function tick() {
  const v = mainVideo();
  if (!v || !state.segments.length) return;
  const { mute, cover, skipTo } = decide(v.currentTime, state.segments, state.prefs);
  if (skipTo !== null && skipTo > v.currentTime + 0.05) { v.currentTime = skipTo; return; }
  // Only undo a mute WE applied — never unmute a viewer who muted themselves.
  if (mute && !v.muted) { v.muted = true; state.weMuted = true; }
  else if (!mute && state.weMuted) { v.muted = false; state.weMuted = false; }
  ensureCover().style.display = cover ? "flex" : "none";
}

// ── Caption collection for AI drafting ──────────────────────────────────────
// Caption lines are what the service already shows the viewer. We record the line and
// the playhead time; the text is sent once for AI drafting and is NOT stored server-side.
function watchCaptions() {
  let last = "";
  new MutationObserver(() => {
    const text = [...document.querySelectorAll(adapter.captionSelector)].map(n => n.textContent.trim()).join(" ").trim();
    const v = mainVideo();
    if (!text || text === last || !v) return;
    last = text;
    state.cues.push({ t: +v.currentTime.toFixed(2), text });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function loadMap() {
  state.titleId = adapter.titleId(location);
  if (!state.titleId) return;
  try {
    const r = await fetch(`${API}/map?service=${adapter.name}&title=${encodeURIComponent(state.titleId)}`);
    if (r.ok) state.segments = normalize((await r.json()).segments || []);
  } catch { /* offline / no map yet — play unfiltered */ }
}

// When enough captions are collected and no AI draft exists yet, ask for one.
async function submitCuesForDraft() {
  if (state.cues.length < 30 || state.segments.some(s => s.source === "ai")) return;
  const cues = state.cues.splice(0);
  try {
    await fetch(`${API}/draft-map`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: adapter.name, title: state.titleId, cues }),
    });
  } catch { state.cues.unshift(...cues); }
}

if (adapter) {
  chrome.storage?.sync.get("prefs", ({ prefs }) => { if (prefs) state.prefs = { ...DEFAULT_PREFS, ...prefs }; });
  loadMap();
  watchCaptions();
  setInterval(tick, 100);                 // 100ms: fine enough for mute/skip boundaries
  setInterval(submitCuesForDraft, 120000);
  addEventListener("popstate", loadMap);  // both services navigate client-side
}

// Content script: finds the service's own <video>, fetches the community map for this
// title, and applies it by MUTING, SEEKING, or COVERING the player — the same controls
// a viewer has. It never reads, captures, copies, or decrypts the video.
import { decide, DEFAULT_PREFS, normalize } from "./segments.js";
import { parseTTML, parseVTT, looksLikeCaptions, estimateOffset } from "./captions-core.js";
import { prime } from "./adapters/prime.js";
import { disney } from "./adapters/disney.js";
import { netflix } from "./adapters/netflix.js";
import { API } from "./config.js";

// The config ships with a placeholder. Until it's replaced, make NO network requests —
// otherwise caption text gets posted to an address nobody controls.
const API_READY = !/YOUR-PROJECT/i.test(API);

const adapter = [prime, disney, netflix].find(a => a.matches(location));
const state = {
  segments: [], prefs: DEFAULT_PREFS, cues: [], titleId: null, cover: null, weMuted: false,
  track: [],          // cues from the caption FILE, on the file's clock
  offset: null,       // player time − file time, measured from on-screen captions
  align: null,        // last alignment result, for debugging
  sentUpTo: 0,        // how many track cues have been sent
};
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
  if (skipTo !== null && skipTo > v.currentTime + 0.05) {
    if (adapter.seekViaPage) {
      // Ask the page-context script to seek with the service's own player API; don't
      // re-ask every tick while the seek is in flight.
      if (state.pendingSeek !== skipTo || Date.now() - state.pendingSeekAt > 1500) {
        state.pendingSeek = skipTo; state.pendingSeekAt = Date.now();
        window.postMessage({ __sansSeek: true, to: skipTo }, location.origin);
      }
    } else v.currentTime = skipTo;
    return;
  }
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
    // innerText, not textContent: captions wrap onto two lines, and textContent drops the
    // break — observed on Prime as "passinghas", "armiesacross". A word fused to its
    // neighbour defeats the profanity matcher's word boundaries, so a swear word at a
    // line end would slip through.
    const text = [...document.querySelectorAll(adapter.captionSelector)]
      .map(n => n.innerText).join(" ").replace(/\s+/g, " ").trim();
    const v = mainVideo();
    if (!text || text === last || !v) return;
    last = text;
    state.cues.push({ t: +v.currentTime.toFixed(2), text });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function loadMap() {
  state.segments = [];
  state.titleId = adapter.titleId(location);
  if (!state.titleId || !API_READY) return;
  try {
    const r = await fetch(`${API}/map?service=${adapter.name}&title=${encodeURIComponent(state.titleId)}`);
    if (r.ok) state.segments = normalize((await r.json()).segments || []);
  } catch { /* offline / no map yet — play unfiltered */ }
}

function titleName() {
  return document.title.replace(/^Watch\s+/i, "").replace(/\s*[|–-]\s*(Prime Video|Disney\+).*$/i, "").trim().slice(0, 200);
}

// Send cues (already on the PLAYER's clock) and apply the map the server returns.
async function sendCues(cues) {
  if (!API_READY || !state.titleId || !cues.length) return false;
  try {
    const r = await fetch(`${API}/draft-map`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: adapter.name, title: state.titleId, name: titleName(), cues }),
    });
    if (!r.ok) return false;
    const body = await r.json();
    if (Array.isArray(body.segments)) state.segments = normalize(body.segments);
    return true;
  } catch { return false; }
}

// ── Caption FILE capture (reads ahead, so profanity is muted before it's spoken) ──
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  // Catcher diagnostics, keyed by frame, so __sansDebug.intercept shows every frame's view.
  if (e.data?.__sansDiag) { (state.intercept ??= {})[e.data.diag.frame] = e.data.diag; return; }
  // Accept from this page or its same-origin frames (Prime's player may be in an iframe).
  if (!e.data?.__sansCaptions) return;
  const kind = looksLikeCaptions(e.data.text);
  if (!kind) return;
  const fresh = kind === "ttml" ? parseTTML(e.data.text) : parseVTT(e.data.text);
  const seen = new Set(state.track.map(c => c.start.toFixed(2) + c.text));
  for (const c of fresh) if (!seen.has(c.start.toFixed(2) + c.text)) state.track.push(c);
  state.track.sort((a, b) => a.start - b.start);
  syncTrack();
});

// Once the file's clock is aligned to the player's, send any not-yet-sent cues.
// Nothing is sent unaligned: a wrong offset would put every mute in the wrong place.
async function syncTrack() {
  if (!state.track.length) return;
  if (state.offset === null) {
    state.align = estimateOffset(state.cues, state.track);
    if (state.align.offset === null) return;
    state.offset = state.align.offset;
    state.sentUpTo = 0;
  }
  const batch = state.track.slice(state.sentUpTo).map(c => ({
    t: +(c.start + state.offset).toFixed(2), end: +(c.end + state.offset).toFixed(2), text: c.text,
  }));
  if (batch.length && await sendCues(batch)) state.sentUpTo = state.track.length;
}

// Fallback when no caption file was caught: send what was read off the screen.
async function submitScreenCues() {
  if (state.track.length || state.cues.length < 30) return;
  if (await sendCues(state.cues.slice())) state.cues = [];
}

if (adapter) {
  chrome.storage?.sync.get("prefs", ({ prefs }) => { if (prefs) state.prefs = { ...DEFAULT_PREFS, ...prefs }; });
  loadMap();
  watchCaptions();
  setInterval(tick, 100);                 // 100ms: fine enough for mute/skip boundaries
  setInterval(syncTrack, 3000);            // alignment improves as on-screen captions arrive
  setInterval(submitScreenCues, 120000);
  // Both services navigate client-side with pushState, which fires no event. Poll the
  // URL; on a title change, reload the map and DROP collected captions so one title's
  // captions never end up drafting another title's map.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const next = adapter.titleId(location);
    if (next !== state.titleId) {
      Object.assign(state, { cues: [], track: [], offset: null, align: null, sentUpTo: 0 });
      loadMap();
    }
  }, 500);
}

// Content script: finds the service's own <video>, fetches the community map for this
// title, and applies it by MUTING, SEEKING, or COVERING the player — the same controls
// a viewer has. It never reads, captures, copies, or decrypts the video.
import { decide, prepare, DEFAULT_PREFS } from "./segments.js";
import { parseTTML, parseVTT, looksLikeCaptions, estimateOffset } from "./captions-core.js";
import { prime } from "./adapters/prime.js";
import { disney } from "./adapters/disney.js";
import { netflix } from "./adapters/netflix.js";
import { API } from "./config.js";
import { installReportHotkey, reportSegment, toast, fmt } from "./report.js";
import { activeSettings, refresh as refreshAccount, rate } from "./account.js";
import { LABELS, STRENGTH } from "./profiles.js";

// The config ships with a placeholder. Until it's replaced, make NO network requests —
// otherwise caption text gets posted to an address nobody controls.
const API_READY = !/YOUR-PROJECT/i.test(API);

const adapter = [prime, disney, netflix].find(a => a.matches(location));
const state = {
  raw: [],            // the title's map as the server sent it (with ids, severity, status)
  mine: [],           // this viewer's own reports this visit, applied whatever the profile
  segments: [],       // what the active profile filters: prepare(raw + mine, prefs)
  prefs: DEFAULT_PREFS, cues: [], titleId: null, cover: null, weMuted: false,
  lastFiltered: null, // { category, action, start, end, at } for "rate what it just filtered"
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

// Recompute what the active profile filters. Called when the map or the profile changes.
function applyMap(serverSegments) {
  if (serverSegments) state.raw = serverSegments;
  state.segments = prepare([...state.raw, ...state.mine], state.prefs);
}

function noteFiltered(t) {
  const s = state.segments.find(x => t >= x.start && t < x.end);
  if (!s) return;
  const action = state.prefs[s.category]?.action;
  state.lastFiltered = { category: s.category, action, start: s.start, end: s.end, at: Date.now() };
}

function tick() {
  const v = mainVideo();
  if (!v || !state.segments.length) return;
  const { mute, cover, skipTo } = decide(v.currentTime, state.segments, state.prefs);
  if (mute || cover || skipTo !== null) noteFiltered(v.currentTime);
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
  state.mine = []; state.lastFiltered = null;
  applyMap([]);
  state.titleId = adapter.titleId(location);
  if (!state.titleId || !API_READY) return;
  try {
    const r = await fetch(`${API}/map?service=${adapter.name}&title=${encodeURIComponent(state.titleId)}`);
    if (r.ok) applyMap((await r.json()).segments || []);
  } catch { /* offline / no map yet — play unfiltered */ }
}

// Netflix's tab title is just "Netflix", so adapters can read the name from the player.
// A bare service name is sent as "" so the server keeps any real name it already has.
function titleName() {
  const fromPlayer = adapter.titleName?.();
  const name = (fromPlayer || document.title).replace(/^Watch\s+/i, "")
    .replace(/\s*[|–-]\s*(Prime Video|Disney\+|Netflix).*$/i, "").trim().slice(0, 200);
  return /^(netflix|prime video|disney\+|amazon\.com)?$/i.test(name) ? "" : name;
}

// Send cues (already on the PLAYER's clock) and apply the map the server returns.
// One request at a time, and after a 429 (server rate limit) wait before trying again
// rather than retrying on every 3-second sync.
let sending = false, backoffUntil = 0;
async function sendCues(cues) {
  if (!API_READY || !state.titleId || !cues.length || sending || Date.now() < backoffUntil) return false;
  sending = true;
  try {
    const r = await fetch(`${API}/draft-map`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: adapter.name, title: state.titleId, name: titleName(), cues }),
    });
    if (r.status === 429 || r.status === 503) {
      backoffUntil = Date.now() + 1000 * (+r.headers.get("Retry-After") || 60);
      return false;
    }
    if (!r.ok) return false;
    const body = await r.json();
    if (Array.isArray(body.segments)) applyMap(body.segments);
    return true;
  } catch { return false; } finally { sending = false; }
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

// ── "Missed one" report (Alt/Option+M, then 1–4, then how strong) ───────────
// Applied locally first, so a scene that's still playing is skipped right now and a
// rewind into it is filtered, then sent so the next viewer gets it too.
async function report(category, severity) {
  const v = mainVideo();
  if (!v || !state.titleId) { toast("Sans: no title found on this page."); return; }
  const t = v.currentTime;
  state.mine.push(reportSegment(t, category, severity));
  applyMap();
  if (!API_READY) return;
  try {
    const r = await fetch(`${API}/report`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: adapter.name, title: state.titleId, name: titleName(), t: +t.toFixed(2), category, severity }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    if (Array.isArray(body.segments)) applyMap(body.segments);
    toast(`Sans: reported ${STRENGTH[severity].toLowerCase()} ${LABELS[category].toLowerCase()} at ${fmt(t)}. Thanks, it's filtered for everyone now.`);
  } catch (err) {
    toast(`Sans: filtered here, but the report didn't send (${err.message}).`);
  }
}

// Rate what Sans just filtered: its strength (1–3), or 0 = it shouldn't be filtered.
// Needs a linked account, so one person can't flood ratings anonymously.
async function rateRecent(r, severity) {
  const ids = state.raw.filter(s => s.id && s.category === r.category && s.start < r.end && s.end > r.start).map(s => s.id);
  if (!ids.length) { toast("Sans: that was your own report, so there's nothing to rate yet."); return; }
  try {
    await rate(ids.slice(0, 10), severity);
  } catch (err) {
    toast(err.message === "not linked"
      ? "Sans: to rate scenes, sign in on the Sans website (click the Sans icon → Sign in)."
      : `Sans: rating didn't send (${err.message}).`, 5000);
    return;
  }
  // Apply the viewer's own rating here at once. For everyone else it changes only once
  // others agree (strength: 2+ ratings; removal: net -3 votes; see the votes migration).
  state.raw = severity
    ? state.raw.map(s => ids.includes(s.id) ? { ...s, severity } : s)
    : state.raw.filter(s => !ids.includes(s.id));
  applyMap();
  toast(severity
    ? `Sans: rated ${STRENGTH[severity].toLowerCase()}. Thanks. It changes for everyone once another viewer agrees.`
    : "Sans: unfiltered for you. It's removed for everyone once a few more viewers agree.", 5000);
}

// Fallback when no caption file was caught: send what was read off the screen.
async function submitScreenCues() {
  if (state.track.length || state.cues.length < 30) return;
  if (await sendCues(state.cues.slice())) state.cues = [];
}

if (adapter) {
  // Who's watching: the popup's active profile. Changes apply mid-title.
  const loadProfile = async () => { state.prefs = await activeSettings(); applyMap(); };
  loadProfile();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.profiles || changes.activeProfile)) loadProfile();
  });
  refreshAccount().catch(() => { /* offline or not linked: use the cached profiles */ });
  loadMap();
  watchCaptions();
  const hotkey = installReportHotkey({
    onReport: report,
    onRate: rateRecent,
    // Offer "rate it" for 20s after something was filtered.
    recent: () => state.lastFiltered && Date.now() - state.lastFiltered.at < 20000 ? state.lastFiltered : null,
  });
  // The browser-level shortcut (manifest "commands" → background.js) arrives as a message.
  chrome.runtime.onMessage?.addListener((msg) => { if (msg?.sansReport) hotkey.toggle(); });
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

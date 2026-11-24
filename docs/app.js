// Sans Maps — browse and correct community filter maps.
// Reads are public. Signed-in users can vote on segments and add or correct them;
// row-level security enforces that (supabase/migrations/), not this page.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { fmt, parse, esc } from "./time.js";
import { CATEGORIES, LABELS, STRENGTH, ACTIONS, RUBRIC, PRESETS, presetOf, withPreset, clean } from "./profiles.js";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const CATS = ["profanity", "nudity", "sex", "violence"];
const SERVICE = { prime: "Prime Video", disney: "Disney+", netflix: "Netflix" };
const view = document.getElementById("view");
let user = null;
let myVotes = new Map();   // segment_id -> vote
let mySeverity = new Map(); // segment_id -> my strength rating (1–3)
const API = SUPABASE_URL + "/functions/v1";

// ── Auth (email magic link) ────────────────────────────────────────────────
async function renderAuth() {
  const el = document.getElementById("auth");
  if (user) {
    el.innerHTML = `<a href="#/account">Profiles</a><span class="muted small">${esc(user.email)}</span><button id="out">Sign out</button>`;
    el.querySelector("#out").onclick = async () => { await db.auth.signOut(); };
  } else {
    el.innerHTML = `<form id="signin" class="auth"><input type="email" required placeholder="you@email.com" aria-label="Email">
      <button class="primary">Sign in to edit</button></form>`;
    el.querySelector("#signin").onsubmit = async (e) => {
      e.preventDefault();
      const email = e.target.querySelector("input").value.trim();
      const { error } = await db.auth.signInWithOtp({
        email, options: { emailRedirectTo: location.origin + location.pathname },
      });
      el.innerHTML = error
        ? `<span class="small" style="color:var(--danger)">${esc(error.message)}</span>`
        : `<span class="muted small">Check ${esc(email)} for a sign-in link.</span>`;
    };
  }
}

db.auth.onAuthStateChange(async (_e, session) => {
  user = session?.user ?? null;
  await loadMyVotes();
  renderAuth();
  route();
});

async function loadMyVotes() {
  myVotes = new Map(); mySeverity = new Map();
  if (!user) return;
  const [{ data }, { data: sev }] = await Promise.all([
    db.from("votes").select("segment_id, vote").eq("user_id", user.id),
    db.from("severity_votes").select("segment_id, severity").eq("user_id", user.id),
  ]);
  for (const v of data ?? []) myVotes.set(v.segment_id, v.vote);
  for (const v of sev ?? []) mySeverity.set(v.segment_id, v.severity);
}

// ── Routing ────────────────────────────────────────────────────────────────
addEventListener("hashchange", route);
function route() {
  if (location.hash.startsWith("#/account")) return renderAccount();
  const m = location.hash.match(/^#\/t\/(\d+)/);
  return m ? renderTitle(+m[1]) : renderHome();
}

const notice = (msg, err) => `<div class="notice${err ? " err" : ""}">${esc(msg)}</div>`;

// ── Home: every title with a map ───────────────────────────────────────────
async function renderHome() {
  const [{ data: titles, error }, { data: segs }] = await Promise.all([
    db.from("titles").select("id, service, service_id, name, created_at").order("created_at", { ascending: false }),
    db.from("segments").select("title_id, category"),
  ]);
  if (error) { view.innerHTML = notice("Couldn't load maps: " + error.message, true); return; }
  const counts = new Map();
  for (const s of segs ?? []) {
    const c = counts.get(s.title_id) ?? {}; c[s.category] = (c[s.category] ?? 0) + 1; counts.set(s.title_id, c);
  }
  view.innerHTML = `<div class="hero"><p class="word">SANS</p><p>filter maps for the shows you already watch.</p></div>
    <h2>Maps</h2>
    <p class="muted small">Made automatically when someone watches with the Sans extension and captions on.
    Sign in to confirm, correct, or add scenes.</p>
    ${titles?.length ? `<ul class="titles">${titles.map(t => {
      const c = counts.get(t.id) ?? {};
      const chips = CATS.filter(k => c[k]).map(k => `<span class="chip ${k}">${c[k]} ${k}</span>`).join("");
      return `<li><a class="card" href="#/t/${t.id}">
        <span><strong>${esc(t.name || t.service_id)}</strong><br><span class="svc">${esc(SERVICE[t.service] ?? t.service)}</span></span>
        <span class="chips">${chips || '<span class="muted small">no segments yet</span>'}</span></a></li>`;
    }).join("")}</ul>` : notice("No maps yet. Watch something on Prime Video with the extension and captions on.")}`;
}

// ── Title: timeline, segments, voting, corrections ─────────────────────────
async function renderTitle(id) {
  const [{ data: t }, { data: segs, error }] = await Promise.all([
    db.from("titles").select("*").eq("id", id).maybeSingle(),
    db.from("segments").select("id, start_s, end_s, category, severity, drafted_severity, source, status, score").eq("title_id", id).order("start_s"),
  ]);
  if (!t) { view.innerHTML = notice("Map not found.", true) + `<p><a href="#/">All maps</a></p>`; return; }
  if (error) { view.innerHTML = notice(error.message, true); return; }
  const end = Math.max(60, ...segs.map(s => s.end_s)) * 1.03;

  view.innerHTML = `<p><a href="#/">← All maps</a></p>
    <h1>${esc(t.name || t.service_id)}</h1>
    <p class="muted small">${esc(SERVICE[t.service] ?? t.service)} · ${esc(t.service_id)}</p>
    <div class="timeline" role="img" aria-label="Where filtered segments fall in the title">
      ${segs.map(s => `<i title="${esc(s.category)} ${fmt(s.start_s)}–${fmt(s.end_s)}"
        style="left:${(s.start_s / end * 100).toFixed(3)}%;width:${((s.end_s - s.start_s) / end * 100).toFixed(3)}%;background:var(--${s.category})"></i>`).join("")}
    </div>
    <div class="axis"><span>0:00</span><span>${fmt(end / 2)}</span><span>${fmt(end)}</span></div>
    <div class="chips" style="margin-top:8px">${CATS.map(k => `<span class="chip ${k}">${k}</span>`).join("")}</div>

    <h2>Segments (${segs.length})</h2>
    ${segs.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Start</th><th>End</th><th>Category</th><th>Strength</th><th>Source</th><th>Status</th><th>Score</th>${user ? "<th></th>" : ""}</tr></thead>
      <tbody>${segs.map(s => row(s)).join("")}</tbody></table></div>` : notice("No segments yet.")}

    <h2>Add a scene</h2>
    ${user ? addForm() : notice("Sign in (top right) to add or correct scenes.")}
    <div id="msg"></div>`;

  view.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => vote(+b.dataset.id, +b.dataset.vote, id));
  view.querySelectorAll("[data-sev]").forEach(sel => sel.onchange = () => rateSeverity(+sel.dataset.sev, +sel.value, id));
  view.querySelectorAll("[data-fix]").forEach(b => b.onclick = () => correct(segs.find(s => s.id === +b.dataset.fix), id));
  view.querySelector("#add")?.addEventListener("submit", (e) => { e.preventDefault(); addSegment(id, new FormData(e.target)); });
}

function row(s) {
  const mine = myVotes.get(s.id);
  return `<tr>
    <td>${fmt(s.start_s)}</td><td>${fmt(s.end_s)}</td>
    <td><span class="chip ${esc(s.category)}">${esc(s.category)}</span></td>
    <td>${strengthCell(s)}</td>
    <td><span class="badge">${esc(s.source)}</span></td>
    <td><span class="badge ${s.status === "confirmed" ? "confirmed" : ""}">${esc(s.status)}</span></td>
    <td>${s.score ?? 0}</td>
    ${user ? `<td class="actions">
      <button data-vote="1" data-id="${s.id}" aria-label="Confirm" ${mine === 1 ? "disabled" : ""}>👍</button>
      <button data-vote="-1" data-id="${s.id}" aria-label="Reject" ${mine === -1 ? "disabled" : ""}>👎</button>
      <button data-fix="${s.id}">Correct times</button></td>` : ""}
  </tr>`;
}

// Strength: everyone sees the current value; signed-in people rate it. The median rating
// wins (supabase/migrations/…profiles_and_severity.sql). Subtitle swears are rated by the
// word list and regenerated on each viewing, so they aren't rated here.
function strengthCell(s) {
  const label = `${STRENGTH[s.severity] ?? "?"}`;
  const tip = esc(RUBRIC[s.category]?.[s.severity] ?? "");
  if (s.source === "captions") return `<span title="${tip}">${label}</span> <span class="muted small">word list</span>`;
  if (!user) return `<span title="${tip}">${label}</span>`;
  const mine = mySeverity.get(s.id);
  const was = s.drafted_severity && s.drafted_severity !== s.severity ? ` <span class="muted small">drafted ${STRENGTH[s.drafted_severity].toLowerCase()}</span>` : "";
  return `<select data-sev="${s.id}" aria-label="Rate strength" title="${tip}">
    ${mine ? "" : `<option value="0" selected>${label} · rate</option>`}
    ${[1, 2, 3].map(n => `<option value="${n}" ${mine === n ? "selected" : ""}>${STRENGTH[n]}</option>`).join("")}
  </select>${was}`;
}

async function rateSeverity(segmentId, severity, titleId) {
  if (!severity) return;
  const { error } = await db.from("severity_votes").upsert({ segment_id: segmentId, user_id: user.id, severity });
  if (error) return showMsg("Rating failed: " + error.message, true);
  mySeverity.set(segmentId, severity);
  // Rating a scene's strength also says it's real.
  if (myVotes.get(segmentId) !== 1) {
    await db.from("votes").upsert({ segment_id: segmentId, user_id: user.id, vote: 1 });
    myVotes.set(segmentId, 1);
  }
  renderTitle(titleId);
}

function addForm() {
  return `<form id="add" class="card form">
    <label>Start<input name="start" placeholder="1:02:03" required></label>
    <label>End<input name="end" placeholder="1:03:10" required></label>
    <label>Category<select name="category">${CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
    <label>Strength<select name="severity"><option value="1">mild</option><option value="2" selected>moderate</option><option value="3">strong</option></select></label>
    <button class="primary">Add</button></form>`;
}

function showMsg(text, err) { const m = document.getElementById("msg"); if (m) m.innerHTML = notice(text, err); }

async function vote(segmentId, v, titleId) {
  const { error } = await db.from("votes").upsert({ segment_id: segmentId, user_id: user.id, vote: v });
  if (error) return showMsg("Vote failed: " + error.message, true);
  myVotes.set(segmentId, v);
  renderTitle(titleId);
}

async function insertHuman(titleId, start, end, category, severity) {
  if (!(end > start) || start < 0) { showMsg("End must be after start (use 1:02:03 or seconds).", true); return null; }
  const { data, error } = await db.from("segments").insert({
    title_id: titleId, start_s: start, end_s: end, category, severity,
    source: "human", status: "draft", author: user.id,
  }).select("id").single();
  if (error) { showMsg("Couldn't save: " + error.message, true); return null; }
  // The author's own vote confirms it (test-group thresholds are ±1).
  await db.from("votes").upsert({ segment_id: data.id, user_id: user.id, vote: 1 });
  myVotes.set(data.id, 1);
  return data.id;
}

async function addSegment(titleId, form) {
  const ok = await insertHuman(titleId, parse(form.get("start")), parse(form.get("end")),
    form.get("category"), +form.get("severity"));
  if (ok) renderTitle(titleId);
}

// A correction = a new human segment with the right times + a rejection of the old one.
async function correct(seg, titleId) {
  const s = prompt(`New start for this ${seg.category} segment`, fmt(seg.start_s));
  if (s === null) return;
  const e = prompt("New end", fmt(seg.end_s));
  if (e === null) return;
  const id = await insertHuman(titleId, parse(s), parse(e), seg.category, mySeverity.get(seg.id) ?? seg.severity ?? 2);
  if (!id) return;
  await db.from("votes").upsert({ segment_id: seg.id, user_id: user.id, vote: -1 });
  myVotes.set(seg.id, -1);
  renderTitle(titleId);
}

// ── Account: profiles, the extension in this browser, linked devices ───────
// The extension's site-bridge.js answers {__sans:"hello"} with {__sansExt:{version, linked}}.
let ext = null;
addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin || !e.data?.__sansExt) return;
  if (e.data.__sansExt.error) { showMsg("Extension: " + e.data.__sansExt.error, true); return; }
  ext = e.data.__sansExt;
  if (location.hash.startsWith("#/account")) renderExtension();
});
const toExt = (msg) => postMessage({ __sans: msg.type, ...msg }, location.origin);

let profiles = [];
async function renderAccount() {
  if (!user) {
    view.innerHTML = `<p><a href="#/">← All maps</a></p><h1>Profiles</h1>
      ${notice("Sign in (top right) to keep filter profiles in your account and use them on every device.")}`;
    return;
  }
  const [{ data, error }, { data: devices }] = await Promise.all([
    db.from("household_profiles").select("id, name, settings, position").order("position").order("created_at"),
    db.from("devices").select("id, label, created_at, last_seen").order("created_at"),
  ]);
  if (error) { view.innerHTML = notice(error.message, true); return; }
  profiles = data.map(p => ({ ...p, settings: clean(p.settings) }));
  view.innerHTML = `<p><a href="#/">← All maps</a></p>
    <h1>Profiles</h1>
    <p class="muted small">Who's watching decides what's filtered. Pick the profile from the Sans icon in Chrome.
      Strength: <strong>mild and up</strong> filters the most; <strong>strong only</strong> the least.</p>
    <div id="profiles">${profiles.map(profileCard).join("") || notice("No profiles yet.")}</div>
    <p>${profiles.length < 8 ? `<button id="addp" class="primary">Add profile</button>` : ""} <span id="saved" class="muted small"></span></p>
    <h2>Extension in this browser</h2><div id="ext">${notice("Looking for the Sans extension…")}</div>
    <h2>Linked devices (${devices?.length ?? 0})</h2>
    ${devices?.length ? `<div class="card table-wrap"><table><thead><tr><th>Device</th><th>Linked</th><th>Last used</th><th></th></tr></thead><tbody>
      ${devices.map(d => `<tr><td>${esc(d.label)}</td><td>${new Date(d.created_at).toLocaleDateString()}</td>
        <td>${new Date(d.last_seen).toLocaleDateString()}</td><td><button data-unlink="${d.id}">Unlink</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted small">None yet.</p>`}
    <div id="msg"></div>`;

  view.querySelector("#addp")?.addEventListener("click", addProfile);
  view.querySelectorAll("[data-unlink]").forEach(b => b.onclick = async () => {
    const { error } = await db.from("devices").delete().eq("id", b.dataset.unlink);
    if (error) return showMsg(error.message, true);
    renderAccount();
  });
  wireProfiles();
  renderExtension();
  toExt({ type: "hello" });
}

const ACTION_LABEL = { off: "Allow", mute: "Mute", cover: "Cover", skip: "Skip" };
function profileCard(p) {
  const preset = presetOf(p.settings);
  return `<div class="card profile" data-pid="${p.id}">
    <div class="row"><input data-f="name" value="${esc(p.name)}" maxlength="40" aria-label="Profile name">
      <span class="presets">${Object.entries(PRESETS).map(([k, v]) =>
        `<button data-preset="${k}" class="${preset === k ? "primary" : ""}">${v.label}</button>`).join("")}
        ${preset ? "" : `<button class="primary" disabled>Custom</button>`}</span>
      <button data-del class="ghost" ${profiles.length < 2 ? "disabled" : ""}>Delete</button></div>
    ${CATEGORIES.map(c => { const r = p.settings[c]; return `<div class="rule">
      <span>${LABELS[c]}</span>
      <select data-cat="${c}" data-k="action">${ACTIONS[c].map(a => `<option value="${a}" ${r.action === a ? "selected" : ""}>${ACTION_LABEL[a]}</option>`).join("")}</select>
      <select data-cat="${c}" data-k="min" ${r.action === "off" ? "disabled" : ""}>${[1, 2, 3].map(n =>
        `<option value="${n}" ${r.min === n ? "selected" : ""}>${n === 3 ? "Strong only" : STRENGTH[n] + " and up"}</option>`).join("")}</select>
      <span class="muted small">${r.action === "off" ? "not filtered" : esc(Object.entries(RUBRIC[c]).filter(([n]) => +n >= r.min).map(([, d]) => d).join("; "))}</span>
    </div>`; }).join("")}
    <label class="check"><input type="checkbox" data-f="confirmed" ${p.settings.confirmedOnly ? "checked" : ""}>
      Confirmed scenes only <span class="muted small">(ignore drafts nobody has reviewed; subtitle swears still count)</span></label>
  </div>`;
}

function wireProfiles() {
  view.querySelectorAll(".profile").forEach(card => {
    const p = profiles.find(x => x.id === card.dataset.pid);
    const commit = async (fields) => { await saveProfile(p, fields); };
    card.querySelector("[data-f=name]").onchange = (e) => commit({ name: e.target.value.trim() || "Unnamed" });
    card.querySelector("[data-f=confirmed]").onchange = (e) => commit({ settings: { ...p.settings, confirmedOnly: e.target.checked } });
    card.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => commit({ settings: withPreset(p.settings, b.dataset.preset) }));
    card.querySelectorAll("[data-cat]").forEach(sel => sel.onchange = () => {
      const s = structuredClone(p.settings);
      s[sel.dataset.cat][sel.dataset.k] = sel.dataset.k === "min" ? +sel.value : sel.value;
      commit({ settings: s });
    });
    card.querySelector("[data-del]").onclick = async () => {
      if (!confirm(`Delete the profile "${p.name}"?`)) return;
      const { error } = await db.from("household_profiles").delete().eq("id", p.id);
      if (error) return showMsg(error.message, true);
      toExt({ type: "profiles-changed" });
      renderAccount();
    };
  });
}

async function saveProfile(p, fields) {
  const { error } = await db.from("household_profiles").update(fields).eq("id", p.id);
  if (error) return showMsg("Couldn't save: " + error.message, true);
  Object.assign(p, fields);
  toExt({ type: "profiles-changed" });
  const card = view.querySelector(`[data-pid="${p.id}"]`);
  card.outerHTML = profileCard(p);
  wireProfiles();
  const s = document.getElementById("saved"); if (s) s.textContent = "Saved.";
}

async function addProfile() {
  const { error } = await db.from("household_profiles").insert({
    name: profiles.length ? `Profile ${profiles.length + 1}` : "Me",
    settings: PRESETS.kids.settings, position: profiles.length,
  });
  if (error) return showMsg(error.message, true);
  toExt({ type: "profiles-changed" });
  renderAccount();
}

function renderExtension() {
  const el = document.getElementById("ext");
  if (!el) return;
  if (!ext) {
    el.innerHTML = `<p class="muted small">No Sans extension found in this browser (version 0.5.0 or later).
      Install or update it, then reload this page.</p>`;
    return;
  }
  if (ext.linked && ext.linked === user.email) {
    el.innerHTML = `<p>Sans ${esc(ext.version)} is linked to this account. Profiles sync automatically.</p>`;
    return;
  }
  el.innerHTML = `<p>${ext.linked ? `Sans ${esc(ext.version)} is linked to ${esc(ext.linked)}.` : `Sans ${esc(ext.version)} found, not linked yet.`}
    Linking syncs your profiles to it and lets you rate scenes from the player (Option/Alt+M).</p>
    <p><button id="link" class="primary">Link the extension to ${esc(user.email)}</button></p>`;
  el.querySelector("#link").onclick = linkExtension;
}

async function linkExtension() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return showMsg("Sign in again first.", true);
  const os = /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows" : /CrOS/.test(navigator.userAgent) ? "ChromeOS" : "Linux";
  const r = await fetch(`${API}/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: "link", label: `Chrome extension on ${os}` }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return showMsg("Couldn't link: " + (body.error ?? r.status), true);
  toExt({ type: "link", token: body.token, email: body.email });
  // The extension uploads its profiles if the account has none; show them.
  setTimeout(renderAccount, 1500);
}

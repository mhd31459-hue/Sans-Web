// Sans Maps — browse and correct community filter maps.
// Reads are public. Signed-in users can vote on segments and add or correct them;
// row-level security enforces that (supabase/migrations/), not this page.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { fmt, parse, esc } from "./time.js";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const CATS = ["profanity", "nudity", "sex", "violence"];
const SERVICE = { prime: "Prime Video", disney: "Disney+", netflix: "Netflix" };
const view = document.getElementById("view");
let user = null;
let myVotes = new Map();   // segment_id -> vote

// ── Auth (email magic link) ────────────────────────────────────────────────
async function renderAuth() {
  const el = document.getElementById("auth");
  if (user) {
    el.innerHTML = `<span class="muted small">${esc(user.email)}</span><button id="out">Sign out</button>`;
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
  myVotes = new Map();
  if (!user) return;
  const { data } = await db.from("votes").select("segment_id, vote").eq("user_id", user.id);
  for (const v of data ?? []) myVotes.set(v.segment_id, v.vote);
}

// ── Routing ────────────────────────────────────────────────────────────────
addEventListener("hashchange", route);
function route() {
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
    db.from("segments").select("id, start_s, end_s, category, severity, source, status, score").eq("title_id", id).order("start_s"),
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
      <thead><tr><th>Start</th><th>End</th><th>Category</th><th>Source</th><th>Status</th><th>Score</th>${user ? "<th></th>" : ""}</tr></thead>
      <tbody>${segs.map(s => row(s)).join("")}</tbody></table></div>` : notice("No segments yet.")}

    <h2>Add a scene</h2>
    ${user ? addForm() : notice("Sign in (top right) to add or correct scenes.")}
    <div id="msg"></div>`;

  view.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => vote(+b.dataset.id, +b.dataset.vote, id));
  view.querySelectorAll("[data-fix]").forEach(b => b.onclick = () => correct(segs.find(s => s.id === +b.dataset.fix), id));
  view.querySelector("#add")?.addEventListener("submit", (e) => { e.preventDefault(); addSegment(id, new FormData(e.target)); });
}

function row(s) {
  const mine = myVotes.get(s.id);
  return `<tr>
    <td>${fmt(s.start_s)}</td><td>${fmt(s.end_s)}</td>
    <td><span class="chip ${esc(s.category)}">${esc(s.category)}</span></td>
    <td><span class="badge">${esc(s.source)}</span></td>
    <td><span class="badge ${s.status === "confirmed" ? "confirmed" : ""}">${esc(s.status)}</span></td>
    <td>${s.score ?? 0}</td>
    ${user ? `<td class="actions">
      <button data-vote="1" data-id="${s.id}" aria-label="Confirm" ${mine === 1 ? "disabled" : ""}>👍</button>
      <button data-vote="-1" data-id="${s.id}" aria-label="Reject" ${mine === -1 ? "disabled" : ""}>👎</button>
      <button data-fix="${s.id}">Correct times</button></td>` : ""}
  </tr>`;
}

function addForm() {
  return `<form id="add" class="card form">
    <label>Start<input name="start" placeholder="1:02:03" required></label>
    <label>End<input name="end" placeholder="1:03:10" required></label>
    <label>Category<select name="category">${CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
    <label>Severity<select name="severity"><option value="1">mild</option><option value="2" selected>moderate</option><option value="3">strong</option></select></label>
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
  const id = await insertHuman(titleId, parse(s), parse(e), seg.category, seg.severity ?? 2);
  if (!id) return;
  await db.from("votes").upsert({ segment_id: seg.id, user_id: user.id, vote: -1 });
  myVotes.set(seg.id, -1);
  renderTitle(titleId);
}

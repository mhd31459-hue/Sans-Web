// Toolbar popup: choose who's watching and edit their filters. Changes apply to any
// playing title at once (the player listens for storage changes).
import { CATEGORIES, LABELS, STRENGTH, ACTIONS, RUBRIC, PRESETS, presetOf, withPreset, newProfile } from "./src/profiles.js";
import { loadState, saveProfiles, setActive, refresh, unlink } from "./src/account.js";
import { SITE } from "./src/config.js";

const $ = (id) => document.getElementById(id);
const ACTION_LABEL = { off: "Allow", mute: "Mute", cover: "Cover", skip: "Skip" };
let state;

const current = () => state.profiles.find(p => p.id === state.activeProfile);
const status = (text, err) => { $("sync").textContent = text; $("sync").className = "small " + (err ? "err" : "muted"); };

async function save() {
  try {
    status("Saving…");
    const { synced } = await saveProfiles(state.profiles);
    state = await loadState();
    status(synced ? "Saved to account" : "Saved");
  } catch (err) { status("Not synced: " + err.message, true); }
}

function render() {
  const p = current();
  $("who").innerHTML = state.profiles.map(x =>
    `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  $("add").disabled = state.profiles.length >= 8;
  $("del").disabled = state.profiles.length < 2;
  $("name").value = p.name;
  const preset = presetOf(p.settings);
  $("presets").innerHTML = Object.entries(PRESETS).map(([k, v]) =>
    `<button data-preset="${k}" class="${preset === k ? "on" : ""}">${v.label}</button>`).join("") +
    (preset ? "" : `<button disabled class="on">Custom</button>`);
  $("cats").innerHTML = CATEGORIES.map(c => {
    const r = p.settings[c];
    return `<div class="cat">
      <span>${LABELS[c]}</span>
      <select data-cat="${c}" data-k="action">${ACTIONS[c].map(a =>
        `<option value="${a}" ${r.action === a ? "selected" : ""}>${ACTION_LABEL[a]}</option>`).join("")}</select>
      <select data-cat="${c}" data-k="min" ${r.action === "off" ? "disabled" : ""}>${[1, 2, 3].map(n =>
        `<option value="${n}" ${r.min === n ? "selected" : ""}>${n === 3 ? "Strong only" : STRENGTH[n] + " and up"}</option>`).join("")}</select>
      <span class="hint">${r.action === "off" ? "Not filtered" : esc(Object.entries(RUBRIC[c])
        .filter(([n]) => +n >= r.min).map(([, d]) => d).join("; "))}</span>
    </div>`;
  }).join("");
  $("confirmed").checked = p.settings.confirmedOnly;

  const a = state.account;
  $("account").innerHTML = a
    ? `<div class="cap">Account</div>${esc(a.email || "Linked")} · profiles sync with the website.
       <div class="row" style="margin-top:8px"><a href="${SITE}#/account" target="_blank">Edit on website</a>
       <span style="flex:1"></span><button id="unlink" class="ghost">Unlink</button></div>`
    : `<div class="cap">Account</div>Profiles are saved in this browser only.
       <a href="${SITE}#/account" target="_blank">Sign in on the website</a> to sync them, use them on other
       devices, and rate scenes from the player.`;
  $("unlink")?.addEventListener("click", async () => { await unlink(); state = await loadState(); render(); status("Unlinked"); });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

$("who").onchange = async (e) => { state.activeProfile = e.target.value; await setActive(e.target.value); render(); status(""); };
$("add").onclick = async () => {
  const p = newProfile(`Profile ${state.profiles.length + 1}`);
  state.profiles.push(p); state.activeProfile = p.id;
  await setActive(p.id); render(); await save();
  $("name").select();
};
$("del").onclick = async () => {
  if (state.profiles.length < 2) return;
  state.profiles = state.profiles.filter(p => p.id !== state.activeProfile);
  state.activeProfile = state.profiles[0].id;
  await setActive(state.activeProfile); render(); await save();
};
$("name").onchange = async (e) => { current().name = e.target.value.trim() || "Unnamed"; render(); await save(); };
$("presets").onclick = async (e) => {
  const k = e.target.dataset?.preset;
  if (!k) return;
  current().settings = withPreset(current().settings, k);
  render(); await save();
};
$("cats").onchange = async (e) => {
  const { cat, k } = e.target.dataset;
  if (!cat) return;
  current().settings[cat][k] = k === "min" ? +e.target.value : e.target.value;
  render(); await save();
};
$("confirmed").onchange = async (e) => { current().settings.confirmedOnly = e.target.checked; render(); await save(); };

state = await loadState();
render();
// Pick up changes made on the website since the popup last opened.
if (state.account) refresh().then(async (ok) => { if (ok) { state = await loadState(); render(); } }).catch(err => status(err.message, true));

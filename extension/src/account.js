// Profiles and the linked account, in chrome.storage.local:
//   profiles:      [{ id, name, settings }]     (a cache of the account's when linked)
//   activeProfile: id
//   account:       { token, email }              (absent = not linked)
// Without an account, profiles live only in this browser. Once linked, the account is
// the source of truth: edits here are saved to it, and the website can change them too.
import { API } from "./config.js";
import { clean, newProfile, DEFAULT_SETTINGS } from "./profiles.js";

const local = () => chrome.storage.local;
const get = (keys) => local().get(keys);
const set = (obj) => local().set(obj);

async function call(token, action, body = {}) {
  const r = await fetch(`${API}/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sans-device": token },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token) await set({ account: null });   // unlinked on the website
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const tidy = (list) => list.map(p => ({ id: p.id, name: String(p.name).slice(0, 40), settings: clean(p.settings) }));

// Always returns at least one profile. Migrates the pre-profile "prefs" setting once.
export async function loadState() {
  let { profiles, activeProfile, account } = await get(["profiles", "activeProfile", "account"]);
  if (!Array.isArray(profiles) || !profiles.length) {
    const old = (await chrome.storage.sync?.get("prefs"))?.prefs;
    profiles = [newProfile("Me", old ? clean(old) : DEFAULT_SETTINGS)];
    activeProfile = profiles[0].id;
    await set({ profiles, activeProfile });
  }
  profiles = tidy(profiles);
  if (!profiles.some(p => p.id === activeProfile)) activeProfile = profiles[0].id;
  return { profiles, activeProfile, account: account || null };
}

export async function activeSettings() {
  const { profiles, activeProfile } = await loadState();
  return profiles.find(p => p.id === activeProfile).settings;
}

export const setActive = (id) => set({ activeProfile: id });

// Save locally first (so the player updates at once), then to the account.
export async function saveProfiles(profiles) {
  profiles = tidy(profiles);
  await set({ profiles });
  const { account } = await get("account");
  if (!account?.token) return { synced: false };
  const { profiles: saved } = await call(account.token, "save-profiles", { profiles });
  await set({ profiles: tidy(saved) });
  return { synced: true };
}

// Pull the account's profiles into this browser. On the very first link, an account
// with no profiles yet receives this browser's.
export async function refresh() {
  const { account } = await get("account");
  if (!account?.token) return false;
  const { profiles } = await call(account.token, "profiles");
  if (profiles.length) await set({ profiles: tidy(profiles) });
  else await saveProfiles((await loadState()).profiles);
  return true;
}

// Called by the website bridge with a freshly issued device token.
export async function link(token, email) {
  await set({ account: { token, email } });
  await refresh();
}

export async function unlink() {
  const { account } = await get("account");
  await set({ account: null });
  if (account?.token) await call(account.token, "unlink").catch(() => {});
}

export async function rate(segmentIds, severity) {
  const { account } = await get("account");
  if (!account?.token) throw new Error("not linked");
  return call(account.token, "rate", { segment_ids: segmentIds, severity });
}

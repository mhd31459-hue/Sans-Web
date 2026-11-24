// POST { action, ... } — accounts for the extension (and later the TV app).
//
//   link           Authorization: Bearer <website login>   → { token }  (a new linked device)
//   profiles       x-sans-device: <token>                   → { profiles }
//   save-profiles  x-sans-device, { profiles: [...] }       → { profiles }
//   rate           x-sans-device, { segment_ids, severity } → { ok }   severity 1–3, or 0 = "shouldn't be filtered"
//   unlink         x-sans-device                            → { ok }
//
// A device holds its own long random token rather than the website's session, so the
// website and the extension never fight over one rotating refresh token, and a device
// can be unlinked on its own. Only the token's SHA-256 is stored.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { CORS, hit, clientKey } from "../_shared/guard.ts";

const MAX_DEVICES = 10, MAX_PROFILES = 8;
const LIMIT = { windowS: 600, max: 120 };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return "sd_" + btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_COLUMNS = "id,name,settings,position";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const allowed = await hit(db, `account:${await clientKey(req)}`, LIMIT);
  if (allowed === null) return json({ error: "rate limiter unavailable" }, 503);
  if (!allowed) return new Response("rate limited", { status: 429, headers: { ...CORS, "Retry-After": "60" } });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // ── link: the website (signed in) asks for a token for this browser's extension ──
  if (b.action === "link") {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = jwt ? await db.auth.getUser(jwt) : { data: null, error: true };
    if (error || !u?.user) return json({ error: "sign in on the website first" }, 401);
    const { count } = await db.from("devices").select("id", { count: "exact", head: true }).eq("user_id", u.user.id);
    if ((count ?? 0) >= MAX_DEVICES) return json({ error: `at most ${MAX_DEVICES} linked devices; unlink one first` }, 409);
    const token = newToken();
    const label = typeof b.label === "string" ? b.label.slice(0, 60) : "Browser extension";
    const { error: ie } = await db.from("devices").insert({ user_id: u.user.id, token_hash: await sha256(token), label });
    if (ie) return json({ error: "link failed" }, 500);
    return json({ token, email: u.user.email });
  }

  // ── everything else: a linked device ──
  const token = req.headers.get("x-sans-device") ?? "";
  if (!token.startsWith("sd_")) return json({ error: "not linked" }, 401);
  const { data: dev } = await db.from("devices").select("id,user_id").eq("token_hash", await sha256(token)).maybeSingle();
  if (!dev) return json({ error: "not linked" }, 401);   // unlinked on the website
  const uid = dev.user_id as string;
  db.from("devices").update({ last_seen: new Date().toISOString() }).eq("id", dev.id).then(() => {});

  const listProfiles = async () => (await db.from("household_profiles").select(PROFILE_COLUMNS)
    .eq("owner", uid).order("position").order("created_at")).data ?? [];

  switch (b.action) {
    case "profiles":
      return json({ profiles: await listProfiles() });

    case "save-profiles": {
      // The device sends its whole list; the account is made to match it.
      const incoming = b.profiles;
      if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > MAX_PROFILES)
        return json({ error: `send 1–${MAX_PROFILES} profiles` }, 400);
      for (const p of incoming)
        if (!p || typeof p.id !== "string" || !UUID.test(p.id) || typeof p.name !== "string" ||
            !p.name.trim() || typeof p.settings !== "object") return json({ error: "bad profile" }, 400);
      const mine = new Set((await listProfiles()).map((p: { id: string }) => p.id));
      const keep = new Set(incoming.map((p: { id: string }) => p.id));
      const gone = [...mine].filter(id => !keep.has(id));
      if (gone.length) await db.from("household_profiles").delete().eq("owner", uid).in("id", gone);
      for (const [i, p] of incoming.entries()) {
        const row = { name: p.name.trim().slice(0, 40), settings: p.settings, position: i };
        // Updates are scoped to this owner, so an id belonging to someone else can't be touched.
        const { error } = mine.has(p.id)
          ? await db.from("household_profiles").update(row).eq("owner", uid).eq("id", p.id)
          : await db.from("household_profiles").insert({ ...row, id: p.id, owner: uid });
        if (error) return json({ error: "couldn't save " + JSON.stringify(row.name), detail: error.message }, 400);
      }
      return json({ profiles: await listProfiles() });
    }

    case "rate": {
      // From the player: "that was strong" also confirms the segment is real;
      // 0 ("shouldn't be filtered") is a vote against it.
      const ids = b.segment_ids, sev = b.severity;
      if (!Array.isArray(ids) || !ids.length || ids.length > 10 || !ids.every(n => Number.isInteger(n) && n > 0) ||
          typeof sev !== "number" || ![0, 1, 2, 3].includes(sev)) return json({ error: "bad request" }, 400);
      const { error: ve } = await db.from("votes").upsert(ids.map(id => ({ segment_id: id, user_id: uid, vote: sev ? 1 : -1 })));
      if (ve) return json({ error: "vote failed" }, 500);
      const { error: se } = sev
        ? await db.from("severity_votes").upsert(ids.map(id => ({ segment_id: id, user_id: uid, severity: sev })))
        : await db.from("severity_votes").delete().eq("user_id", uid).in("segment_id", ids);
      if (se) return json({ error: "rating failed" }, 500);
      return json({ ok: true });
    }

    case "unlink":
      await db.from("devices").delete().eq("id", dev.id);
      return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});

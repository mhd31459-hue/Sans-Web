// POST { service, title, name?, t, category }  →  records a "missed one" report.
//
// Sent when a viewer presses the extension's hotkey because something slipped through.
// Only the playhead time and the category are stored, as a draft segment covering the
// moments before and just after the key press. Reports near each other for the same
// category are merged, so several viewers flagging one scene make one segment.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { CORS, hit, clientKey, TITLE_ID } from "../_shared/guard.ts";

const CATEGORIES = ["profanity", "nudity", "sex", "violence"];
// A viewer reacts after the fact: cover what they just saw, and (for scenes) a little
// ahead in case it's still going. A missed swear is over by the time they press the key.
// The extension uses the same windows (src/report.js) so its instant local fix matches.
const WINDOW: Record<string, [number, number]> = {
  profanity: [8, 1], nudity: [20, 10], sex: [20, 10], violence: [20, 10],
};
const MAX_LEN_S = 300;  // merged reports never grow past five minutes
const LIMIT = { windowS: 600, max: 20 };   // per viewer, 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const allowed = await hit(db, `report:${await clientKey(req)}`, LIMIT);
  if (allowed === null) return new Response("rate limiter unavailable", { status: 503, headers: CORS });
  if (!allowed) return new Response("rate limited", { status: 429, headers: { ...CORS, "Retry-After": "60" } });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return new Response("bad json", { status: 400, headers: CORS }); }
  const { service, title, name, t, category } = b;
  if (typeof service !== "string" || !TITLE_ID[service] || typeof title !== "string" || !TITLE_ID[service].test(title) ||
      typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 86400 ||
      typeof category !== "string" || !CATEGORIES.includes(category))
    return new Response("bad request", { status: 400, headers: CORS });

  const row: Record<string, unknown> = { service, service_id: title };
  if (typeof name === "string" && name.trim()) row.name = name.trim().slice(0, 200);
  const { data: ttl, error: te } = await db.from("titles")
    .upsert(row, { onConflict: "service,service_id" }).select("id").single();
  if (te || !ttl) return Response.json({ error: "title write failed" }, { status: 500, headers: CORS });

  let start = Math.max(0, t - BEFORE_S), end = t + AFTER_S;
  // Merge with an overlapping report of the same category instead of stacking duplicates.
  const { data: near } = await db.from("segments").select("id, start_s, end_s")
    .eq("title_id", ttl.id).eq("source", "report").eq("category", category).neq("status", "rejected")
    .lte("start_s", end).gte("end_s", start).limit(1);
  let error;
  if (near?.length && Math.max(end, near[0].end_s) - Math.min(start, near[0].start_s) <= MAX_LEN_S) {
    start = Math.min(start, near[0].start_s); end = Math.max(end, near[0].end_s);
    ({ error } = await db.from("segments").update({ start_s: start, end_s: end }).eq("id", near[0].id));
  } else {
    ({ error } = await db.from("segments").insert({
      title_id: ttl.id, start_s: start, end_s: end, category, severity: 2, source: "report", status: "draft",
    }));
  }
  if (error) return Response.json({ error: "segment write failed" }, { status: 500, headers: CORS });

  const { data: all } = await db.from("segments")
    .select("start_s,end_s,category,severity,source").eq("title_id", ttl.id).neq("status", "rejected").order("start_s");
  const segments = (all ?? []).map(x => ({ start: x.start_s, end: x.end_s, category: x.category, severity: x.severity, source: x.source }));
  return Response.json({ reported: { start, end, category }, segments }, { headers: CORS });
});

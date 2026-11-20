// GET ?service=prime&title=B0XXXXXXX  →  { segments: [{start,end,category,severity,source}] }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const service = u.searchParams.get("service"), title = u.searchParams.get("title");
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (!service || !title) return new Response("missing params", { status: 400, headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: t } = await db.from("titles").select("id").eq("service", service).eq("service_id", title).maybeSingle();
  if (!t) return Response.json({ segments: [] }, { headers: cors });
  const { data } = await db.from("segments")
    .select("start_s,end_s,category,severity,source").eq("title_id", t.id).neq("status", "rejected").order("start_s");
  const segments = (data ?? []).map(s => ({ start: s.start_s, end: s.end_s, category: s.category, severity: s.severity, source: s.source }));
  return Response.json({ segments }, { headers: cors });
});

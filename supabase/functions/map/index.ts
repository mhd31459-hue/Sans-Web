// GET ?service=prime&title=B0XXXXXXX  →  { segments: [{id,start,end,category,severity,source,status}] }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { titleMap } from "../_shared/segments.ts";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const service = u.searchParams.get("service"), title = u.searchParams.get("title");
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (!service || !title) return new Response("missing params", { status: 400, headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: t } = await db.from("titles").select("id").eq("service", service).eq("service_id", title).maybeSingle();
  if (!t) return Response.json({ segments: [] }, { headers: cors });
  return Response.json({ segments: await titleMap(db, t.id) }, { headers: cors });
});

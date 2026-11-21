// POST { service, title, cues: [{t, text}] }  →  drafts segments for a title.
//
// Caption lines are what the service already displays to the viewer. They're used here
// transiently to draft timestamps and are NOT persisted — only {start,end,category}
// facts are stored. Profanity is matched deterministically (precise, free); sex,
// violence, and nudity are drafted by Claude from dialogue and SDH sound cues
// ("[moaning]", "[gunshot]"), then marked 'draft' for people to confirm or correct.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { profanitySegments, type Cue, type Seg } from "../_shared/profanity.ts";

const MODEL = "claude-haiku-5-5";   // cheap enough to draft every title anyone watches


// The extension calls this from www.amazon.com / www.disneyplus.com pages, so the
// browser sends a CORS preflight first. Without these headers every request is blocked.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

async function draftScenes(cues: Cue[], apiKey: string, segs: Seg[]): Promise<boolean> {
  const transcript = cues.map(c => `${c.t.toFixed(1)}\t${c.text}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system:
        "You draft content-filter timestamps for a family viewing tool. Input is a film's caption " +
        "lines with their start time in seconds, including hard-of-hearing sound cues in brackets. " +
        "Identify scenes likely to contain sexual content, nudity, or graphic violence. Use sound cues, " +
        "dialogue, and context. Scenes usually span several caption lines; extend each segment to cover " +
        "the whole scene. Be conservative: only flag what the captions give real evidence for. " +
        'Reply with ONLY a JSON array: [{"start":s,"end":s,"category":"sex|nudity|violence","severity":1-3}].',
      messages: [{ role: "user", content: transcript }],
    }),
  });
  if (!r.ok) return false;
  {
    const body = await r.json();
    const text = body.content?.[0]?.text ?? "[]";
    try {
      const drafted = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
      for (const d of drafted) {
        if (["sex", "nudity", "violence"].includes(d.category) && d.end > d.start)
          segs.push({ start: +d.start, end: +d.end, category: d.category, severity: Math.min(3, Math.max(1, d.severity | 0 || 2)), source: "ai" });
      }
    } catch { /* model returned non-JSON; keep the caption-derived profanity */ }
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 0. Rate limit before doing any work. Over the limit → 429; if the limiter itself
  //    fails, refuse too (503) rather than run unmetered.
  const who = await clientKey(req);
  const allowed = await hit(db, `req:${who}`, LIMITS.requests);
  if (allowed === null) return new Response("rate limiter unavailable", { status: 503, headers: CORS });
  if (!allowed) return new Response("rate limited", { status: 429, headers: { ...CORS, "Retry-After": "60" } });

  let body: { service?: unknown; title?: unknown; cues?: unknown; name?: unknown };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: CORS }); }
  const { service, title, name } = body;
  const cues = validCues(body.cues);
  if (typeof service !== "string" || !TITLE_ID[service] || typeof title !== "string" ||
      !TITLE_ID[service].test(title) || !cues)
    return new Response("bad request", { status: 400, headers: CORS });

  // 1. Profanity from captions, timed to the WORD within each line (_shared/profanity.ts).
  const segs: Seg[] = profanitySegments(cues);

  // Report database failures instead of claiming success — an earlier version returned
  // {"drafted":2} while every write was being refused for missing table grants.
  const row: Record<string, unknown> = { service, service_id: title };
  if (name) row.name = String(name).slice(0, 200);
  const { data: t, error: te } = await db.from("titles")
    .upsert(row, { onConflict: "service,service_id" }).select("id, ai_drafted_until").single();
  if (te || !t) return Response.json({ error: "title write failed", detail: te?.message }, { status: 500, headers: CORS });

  // 2. Scene-level categories drafted by Claude — only for stretches not yet drafted,
  //    and only once there's enough new dialogue to judge scenes from.
  const fresh = cues.filter(c => c.t > t.ai_drafted_until);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  let aiRan = false;
  if (apiKey && fresh.length >= 40) {
    aiRan = await draftScenes(fresh, apiKey, segs);
    if (aiRan) await db.from("titles").update({ ai_drafted_until: fresh[fresh.length - 1].t }).eq("id", t.id);
  }

  // 3. Persist facts only. The caption text goes out of scope here and is never stored.
  // Caption-derived profanity is deterministic, so REGENERATE it for the stretch these
  // cues cover rather than keeping old copies: that's how improvements (like word-level
  // timing) reach maps made earlier. Rejected segments are kept, so a false positive
  // people voted down is never resurrected; human and AI segments are never touched.
  if (cues.length) {
    const lo = Math.min(...cues.map(c => c.t)) - 1;
    const hi = Math.max(...cues.map(c => c.end ?? c.t)) + 5;
    const { error: de } = await db.from("segments").delete()
      .eq("title_id", t.id).eq("source", "captions").neq("status", "rejected")
      .gte("start_s", lo).lte("end_s", hi);
    if (de) return Response.json({ error: "regenerate failed", detail: de.message }, { status: 500, headers: CORS });
  }
  // Anything still overlapping (AI drafts from repeat viewings, rejected segments) wins.
  const { data: existing } = await db.from("segments")
    .select("start_s,end_s,category").eq("title_id", t.id);
  const novel = segs.filter(n => !(existing ?? []).some(e =>
    e.category === n.category && n.start < e.end_s && n.end > e.start_s));
  segs.length = 0; segs.push(...novel);
  if (segs.length) {
    const { error: se } = await db.from("segments").insert(segs.map(s => ({
      title_id: t.id, start_s: s.start, end_s: s.end, category: s.category, severity: s.severity, source: s.source, status: "draft",
    })));
    if (se) return Response.json({ error: "segment write failed", detail: se.message }, { status: 500, headers: CORS });
  }
  // Send the title's whole current map back, so the extension can apply it at once —
  // including stretches that haven't played yet.
  const { data: all } = await db.from("segments")
    .select("start_s,end_s,category,severity,source").eq("title_id", t.id).neq("status", "rejected").order("start_s");
  const segments = (all ?? []).map(x => ({ start: x.start_s, end: x.end_s, category: x.category, severity: x.severity, source: x.source }));
  return Response.json({ drafted: segs.length, aiRan, segments }, { headers: CORS });
});

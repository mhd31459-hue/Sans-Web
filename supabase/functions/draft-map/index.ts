// POST { service, title, cues: [{t, text}] }  →  drafts segments for a title.
//
// Caption lines are what the service already displays to the viewer. They're used here
// transiently to draft timestamps and are NOT persisted — only {start,end,category}
// facts are stored. Profanity is matched deterministically (precise, free); sex,
// violence, and nudity are drafted by Claude from dialogue and SDH sound cues
// ("[moaning]", "[gunshot]"), then marked 'draft' for people to confirm or correct.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// \w* on BOTH sides of the strong roots: a leading \b alone missed compounds like
// "bullshit", "horseshit", "dipshit", "motherfucker". Short words (dick, cock, damn)
// keep strict boundaries so "dickens", "cockpit", "damnation"-style words don't fire.
const PROFANITY = /\b(\w*fuck\w*|\w*shit\w*|bitch\w*|cunt\w*|\w*asshole\w*|bastard\w*|dick|dicks|cock|cocks|pussy|goddamn\w*|damn|damned|damnit)\b/i;
const MODEL = "claude-haiku-5-5";   // cheap enough to draft every title anyone watches

type Cue = { t: number; text: string };
type Seg = { start: number; end: number; category: string; severity: number; source: string };

// The extension calls this from www.amazon.com / www.disneyplus.com pages, so the
// browser sends a CORS preflight first. Without these headers every request is blocked.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });
  const { service, title, cues } = await req.json() as { service: string; title: string; cues: Cue[] };
  if (!["prime", "disney"].includes(service) || !title || !Array.isArray(cues) || cues.length > 5000)
    return new Response("bad request", { status: 400, headers: CORS });

  // 1. Profanity straight from caption timing (cue-level, so pad a little).
  const segs: Seg[] = [];
  cues.forEach((c, i) => {
    if (PROFANITY.test(c.text)) {
      const next = cues[i + 1]?.t ?? c.t + 3;
      segs.push({ start: Math.max(0, c.t - 0.3), end: Math.min(next, c.t + 4), category: "profanity", severity: 2, source: "captions" });
    }
  });

  // 2. Scene-level categories drafted by Claude.
  const transcript = cues.map(c => `${c.t.toFixed(1)}\t${c.text}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
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
  if (r.ok) {
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

  // 3. Persist facts only. The caption text goes out of scope here and is never stored.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Report database failures instead of claiming success — an earlier version returned
  // {"drafted":2} while every write was being refused for missing table grants.
  const { data: t, error: te } = await db.from("titles")
    .upsert({ service, service_id: title }, { onConflict: "service,service_id" }).select("id").single();
  if (te || !t) return Response.json({ error: "title write failed", detail: te?.message }, { status: 500, headers: CORS });
  // Viewers submit captions in 2-minute batches, and many people may watch the same
  // title, so the same span arrives repeatedly. Drop any new segment that overlaps an
  // existing one of the same category; otherwise every viewing duplicates the map.
  const { data: existing } = await db.from("segments")
    .select("start_s,end_s,category").eq("title_id", t.id);
  const fresh = segs.filter(n => !(existing ?? []).some(e =>
    e.category === n.category && n.start < e.end_s && n.end > e.start_s));
  segs.length = 0; segs.push(...fresh);
  if (segs.length) {
    const { error: se } = await db.from("segments").insert(segs.map(s => ({
      title_id: t.id, start_s: s.start, end_s: s.end, category: s.category, severity: s.severity, source: s.source, status: "draft",
    })));
    if (se) return Response.json({ error: "segment write failed", detail: se.message }, { status: 500, headers: CORS });
  }
  return Response.json({ drafted: segs.length }, { headers: CORS });
});

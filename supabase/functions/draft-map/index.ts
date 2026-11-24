// POST { service, title, cues: [{t, text}] }  →  drafts segments for a title.
//
// Caption lines are what the service already displays to the viewer. They're used here
// transiently to draft timestamps and are NOT persisted — only {start,end,category}
// facts are stored. Profanity is matched deterministically (precise, free); sex,
// violence, and nudity are drafted by Claude from dialogue and SDH sound cues
// ("[moaning]", "[gunshot]"), then marked 'draft' for people to confirm or correct.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { titleMap } from "../_shared/segments.ts";
import { profanitySegments, type Cue, type Seg } from "../_shared/profanity.ts";
import { CORS, hit, clientKey, TITLE_ID } from "../_shared/guard.ts";

// Haiku is cheap enough to draft every title anyone watches; AI_MODEL can switch to a
// larger model, which knows more films and their well-known scenes.
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-haiku-5-5";
const GAP_S = 20;   // a stretch this long with no captions is called out to the model


// ── Abuse limits ────────────────────────────────────────────────────────────
// The endpoint is public (the extension's code shows its URL), so it's metered.
// A normal viewing session makes a handful of requests per title; these leave lots of room.
const LIMITS = {
  requests:    { windowS: 600,   max: 120 },                                          // per viewer, 10 min
  aiPerViewer: { windowS: 86400, max: 30 },                                           // per viewer, day
  aiGlobal:    { windowS: 86400, max: Number(Deno.env.get("AI_DAILY_LIMIT") ?? 200) }, // everyone, day
};
// Cues must be [{t, end?, text}] with sane numbers and short text; anything else → null.
function validCues(v: unknown): Cue[] | null {
  if (!Array.isArray(v) || v.length > 5000) return null;
  for (const c of v) {
    if (!c || typeof c !== "object") return null;
    const { t, end, text } = c as Record<string, unknown>;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 86400) return null;
    if (end !== undefined && (typeof end !== "number" || !Number.isFinite(end) || end < t || end > t + 600)) return null;
    if (typeof text !== "string" || text.length > 500) return null;
  }
  return v as Cue[];
}

// Returns "ok: N scene(s)" or a short reason (HTTP status / parse failure) — never the key or the reply.
async function draftScenes(cues: Cue[], apiKey: string, segs: Seg[], name: string): Promise<string> {
  // Captions are silent about violence played under music or a voiceover, so the model also
  // gets (a) the title, to use what it knows about the film, and (b) explicit marks where
  // nothing is captioned for a while: in a film those stretches are often action or montage.
  const lines: string[] = [];
  cues.forEach((c, i) => {
    const prevEnd = i ? (cues[i - 1].end ?? cues[i - 1].t) : null;
    if (prevEnd !== null && c.t - prevEnd >= GAP_S)
      lines.push(`${prevEnd.toFixed(1)}\t[NO CAPTIONS FOR ${Math.round(c.t - prevEnd)}s]`);
    lines.push(`${c.t.toFixed(1)}\t${c.text}`);
  });
  const transcript = (name ? `Title: ${name}\n\n` : "") + lines.join("\n");
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
        "You draft content-filter timestamps for a family viewing tool. Input is a film's or episode's " +
        "caption lines with their start time in seconds, including hard-of-hearing sound cues in brackets, " +
        "and [NO CAPTIONS FOR Ns] marks where nothing is captioned. Identify scenes likely to contain " +
        "sexual content, nudity, or graphic violence. Captions often say nothing during violence or sex " +
        "played under music, a voiceover, or silence, so infer from everything available: the dialogue " +
        "before and after (threats, a chase, someone wounded or dead, a body, 'are you hurt?'), music " +
        "and sound cues, long uncaptioned stretches, and what you know about this specific title if you " +
        "recognise it. Anchor every timestamp to that caption context; don't invent times from memory " +
        "alone. Scenes usually span several caption lines; extend each segment to cover the whole scene. " +
        "Missing a scene is worse than flagging a calm one: flag likely scenes with severity 2-3 and " +
        "plausible-but-uncertain ones with severity 1. " +
        'Reply with ONLY a JSON array: [{"start":s,"end":s,"category":"sex|nudity|violence","severity":1-3}].',
      messages: [{ role: "user", content: transcript }],
    }),
  });
  if (!r.ok) { console.error("anthropic", r.status, (await r.text()).slice(0, 300)); return `anthropic ${r.status}` + (r.status === 401 && !apiKey.startsWith("sk-ant-api")
    ? " (key should start with sk-ant-api; this looks like a different kind of token)" : ""); }
  {
    const body = await r.json();
    // Read every text block: the first block isn't always text (e.g. a thinking block).
    const text = (body.content ?? []).filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("\n");
    const a = text.indexOf("["), z = text.lastIndexOf("]");
    if (a < 0 || z < a) { console.error("ai reply without JSON", body.stop_reason, text.slice(0, 300)); return `unreadable reply (${body.stop_reason})`; }
    let n = 0;
    try {
      for (const d of JSON.parse(text.slice(a, z + 1))) {
        if (["sex", "nudity", "violence"].includes(d.category) && d.end > d.start) {
          segs.push({ start: +d.start, end: +d.end, category: d.category, severity: Math.min(3, Math.max(1, d.severity | 0 || 2)), source: "ai" });
          n++;
        }
      }
    } catch { console.error("ai reply bad JSON", text.slice(0, 300)); return "unreadable reply (bad JSON)"; }
    return `ok: ${n} scene(s)`;
  }
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
  if (typeof name === "string" && name.trim()) row.name = name.trim().slice(0, 200);
  const { data: t, error: te } = await db.from("titles")
    .upsert(row, { onConflict: "service,service_id" }).select("id, ai_drafted_until, name").single();
  if (te || !t) return Response.json({ error: "title write failed", detail: te?.message }, { status: 500, headers: CORS });

  // 2. Scene-level categories drafted by Claude — only for stretches not yet drafted,
  //    and only once there's enough new dialogue to judge scenes from.
  const fresh = cues.filter(c => c.t > t.ai_drafted_until);
  // Tolerate the usual paste slips: whitespace, quotes, or the whole "NAME=value" line.
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim()
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/, "").replace(/^["']|["']$/g, "");
  // Each Claude call costs money, so it's capped per viewer and across everyone per day.
  // Over the cap, profanity still works; the AI stretch is simply drafted on a later visit.
  // `ai` says what happened, so a silent failure (bad key, no credit) is visible.
  let ai = !apiKey ? "no key" : fresh.length < 40 ? "not enough new lines" : "";
  if (!ai) {
    if (!await hit(db, `ai:${who}`, LIMITS.aiPerViewer)) ai = "viewer daily limit";
    else if (!await hit(db, "ai:global", LIMITS.aiGlobal)) ai = "global daily limit";
    else ai = await draftScenes(fresh, apiKey!, segs, t.name ?? "");
  }
  const aiRan = ai.startsWith("ok");
  if (aiRan) await db.from("titles").update({ ai_drafted_until: fresh[fresh.length - 1].t }).eq("id", t.id);

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
  const segments = await titleMap(db, t.id);
  return Response.json({ drafted: segs.length, aiRan, ai, segments }, { headers: CORS });
});

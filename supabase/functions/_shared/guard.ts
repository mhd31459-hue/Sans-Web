// Shared by the public edge functions: CORS, rate limiting, viewer keys, title-ID rules.
// The extension calls this from www.amazon.com / www.disneyplus.com pages, so the
// browser sends a CORS preflight first. Without these headers every request is blocked.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-sans-device",
};

export type Limit = { windowS: number; max: number };

// Returns true (allowed), false (over the limit) or null (limiter unavailable).
// deno-lint-ignore no-explicit-any
export async function hit(db: any, bucket: string, l: Limit): Promise<boolean | null> {
  const { data, error } = await db.rpc("rate_limit_hit", { p_bucket: bucket, p_window_s: l.windowS, p_max: l.max });
  return error ? null : data === true;
}

// Cloudflare sets cf-connecting-ip and rejects or overwrites client-supplied copies
// (tested 2026-11-21), unlike x-forwarded-for. Only a truncated hash is stored.
export async function clientKey(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("sb-forwarded-for") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sans-rl:" + ip));
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Title IDs as the extension's adapters read them from page URLs.
export const TITLE_ID: Record<string, RegExp> = {
  prime:   /^[A-Za-z0-9.\-]{6,80}$/,   // ASIN (B0B6RPP9KQ) or amzn1.dv.gti.<uuid>
  disney:  /^[A-Za-z0-9\-]{4,80}$/,
  netflix: /^\d{3,12}$/,
};

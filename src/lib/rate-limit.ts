/**
 * A small fixed-window limiter for the public endpoints, which are
 * unauthenticated and have real side effects: `/api/public/slots` triggers a
 * Google free/busy query per request, and `/api/public/book` writes a row,
 * creates a calendar event and sends mail from sothcare.com.
 *
 * State lives in process memory, so with more than one instance each gets its
 * own budget. That is fine as an abuse brake; if you need exact limits across
 * a fleet, swap the Map for Redis/DynamoDB — the interface is one function.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size > MAX_KEYS) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size > MAX_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client address behind ALB / CloudFront.
 *
 * X-Forwarded-For is a left-to-right chain that each hop APPENDS to, so the
 * only entries you can trust are the last `TRUSTED_PROXY_HOPS` of them --
 * those are the ones your own infrastructure added. The client controls
 * everything else in the header, including the entire thing if no proxy is
 * in front yet. Reading the FIRST entry (the old behaviour here) reads
 * exactly the part the client supplied: send a fresh made-up value with
 * every request and you mint yourself a fresh rate-limit bucket every time,
 * which defeats the whole point of limiting these endpoints.
 *
 * Set TRUSTED_PROXY_HOPS to the number of reverse proxies between the
 * client and this app (1 for a single ALB, 2 for CloudFront -> ALB, etc.).
 * Defaults to 1 -- verify this matches your real edge before relying on it.
 */
function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(raw) && raw >= 0 ? raw : 1;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = trustedProxyHops();
    const parts = forwarded.split(",").map((p) => p.trim());
    const index = parts.length - hops;
    // Fewer entries than expected trusted hops means the chain doesn't match
    // the configured topology -- there is no entry here we can actually
    // trust, so fall through to "unknown" rather than guess.
    if (hops > 0 && index >= 0 && index < parts.length) return parts[index]!;
    if (hops === 0) return parts[parts.length - 1]!;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });
}

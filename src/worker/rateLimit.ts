// Minimal per-isolate fixed-window limiter. DEVIATION from the Express build
// (express-rate-limit, same semantics but process-wide in one long-lived
// Node process): a Worker has many short-lived isolates, so this only
// throttles within a single warm isolate, not globally. Acceptable for a
// solo-owner app; if abuse is ever observed, replace with the DB-backed
// pattern already used for omni_bad_sig (bounded table + periodic purge).
import type { Context, Next } from "hono";

interface Bucket {
  count: number;
  resetAt: number;
}

function makeLimiter(windowMs: number, limit: number, message: string) {
  const buckets = new Map<string, Bucket>();
  return async function limiter(c: Context, next: Next): Promise<Response | void> {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const existing = buckets.get(ip);
    if (!existing || existing.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      existing.count += 1;
      if (existing.count > limit) {
        return c.json({ error: message }, 429);
      }
    }
    // Opportunistic cleanup so the map doesn't grow unbounded within a warm isolate.
    if (buckets.size > 5000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(key);
      }
    }
    await next();
  };
}

export const authRateLimiter = makeLimiter(15 * 60 * 1000, 20, "Too many attempts, please try again later.");
export const aiRateLimiter = makeLimiter(60 * 1000, 20, "Too many AI requests, please slow down.");
export const publicTokenRateLimiter = makeLimiter(15 * 60 * 1000, 120, "Not found");

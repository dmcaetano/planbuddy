// DB-backed fixed-window rate limiting (migration 0018_rate_limit.sql).
//
// Replaces the earlier per-isolate in-memory Map design: a Worker has many
// isolates, each with its own empty Map, so that design limited nothing
// globally — a flood of requests just spreads across isolates. Flagged by
// an automated security review (2026-10, before the phase 8 cutover) and
// confirmed real: OmniBuddy has public sign-up and auto-connects new users
// to PlanBuddy (the Buddy Contract's /connect), so "acceptable for a
// solo-owner app" no longer holds once that path is live. Fixed with one
// shared counter table every limiter writes to, keyed on `cf-connecting-ip`
// only (the `x-forwarded-for` fallback was client-spoofable and is dropped
// entirely) or, for aiRateLimiter, the signed-in user id when there is one.
import type { Context, Next } from "hono";
import { getDb } from "../server/db/client.js";
import { logger } from "../server/logger.js";

async function incrementAndCount(bucket: string, key: string, windowMs: number, nowMs: number): Promise<number> {
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs).toISOString();
  const db = await getDb();
  const { rows } = await db.query<{ count: number }>(
    `INSERT INTO rate_limit (bucket, key, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (bucket, key, window_start)
     DO UPDATE SET count = rate_limit.count + 1
     RETURNING count`,
    [bucket, key, windowStart]
  );
  return rows[0]?.count ?? 1;
}

/** Deletes rate-limit windows older than every limiter's window, called from the Worker's 5-minute cron. */
export async function sweepRateLimitWindows(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { rows } = await db.query<{ bucket: string }>(`DELETE FROM rate_limit WHERE window_start < $1 RETURNING bucket`, [cutoff]);
  return rows.length;
}

const clientIp = (c: Context): string => c.req.header("cf-connecting-ip") ?? "unknown";

interface LimiterOptions {
  bucket: string;
  windowMs: number;
  limit: number;
  message: string;
  /** "error" -> {error}; "okFalse" -> {ok:false, error} (the Buddy Contract's own response shape). */
  shape: "error" | "okFalse";
  /** DB unreachable: true refuses the request (auth, AI — never let a DB outage become a free-for-all on paid/sensitive endpoints); false lets it through (public read-only tokens). */
  failClosed: boolean;
  /** Defaults to the request IP. aiRateLimiter overrides this to key on the signed-in user id when there is one. */
  keyFn?: (c: Context) => string;
}

export function makeDbLimiter(opts: LimiterOptions) {
  return async function limiter(c: Context, next: Next): Promise<Response | void> {
    const key = opts.keyFn ? opts.keyFn(c) : clientIp(c);
    try {
      const count = await incrementAndCount(opts.bucket, key, opts.windowMs, Date.now());
      if (count > opts.limit) {
        return opts.shape === "okFalse" ? c.json({ ok: false, error: opts.message }, 429) : c.json({ error: opts.message }, 429);
      }
    } catch (err) {
      logger.warn("Rate limiter DB check failed", { bucket: opts.bucket, failClosed: opts.failClosed, error: (err as Error).message });
      if (opts.failClosed) {
        return c.json({ error: "Service temporarily unavailable" }, 503);
      }
      // Fail open: a public, read-only, already-token-gated endpoint stays reachable through a DB blip.
    }
    await next();
  };
}

export const authRateLimiter = makeDbLimiter({
  bucket: "auth",
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: "Too many attempts, please try again later.",
  shape: "error",
  failClosed: true,
});

export const aiRateLimiter = makeDbLimiter({
  bucket: "ai",
  windowMs: 60 * 1000,
  limit: 20,
  message: "Too many AI requests, please slow down.",
  shape: "error",
  failClosed: true,
  keyFn: (c) => c.get("user")?.id ?? clientIp(c),
});

export const publicTokenRateLimiter = makeDbLimiter({
  bucket: "public",
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: "Not found",
  shape: "error",
  failClosed: false,
});

export const omniLinkRateLimiter = makeDbLimiter({
  bucket: "omnilink",
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: "Too many attempts. Wait a few minutes and try again.",
  shape: "okFalse",
  failClosed: true,
});

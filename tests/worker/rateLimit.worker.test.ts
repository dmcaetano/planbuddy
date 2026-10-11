import { describe, expect, it, beforeAll } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../../src/server/db/migrate.js";
import { makeDbLimiter } from "../../src/worker/rateLimit.js";

// Guards against the exact bug a security review caught before the phase 8
// cutover: an in-memory per-isolate Map limits nothing globally on a
// Worker, since isolates don't share memory. The fix (migration
// 0018_rate_limit.sql) is a DB-backed counter, so two INDEPENDENTLY
// built limiter middleware instances — standing in for two separate
// Worker isolates, which share nothing in memory but DO share the DB —
// must enforce one cumulative count, not two independent ones.
describe("worker: DB-backed rate limiter shares state across isolates", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  async function hit(app: Hono): Promise<number> {
    const res = await app.request("http://test/x", { headers: { "cf-connecting-ip": "203.0.113.9" } });
    return res.status;
  }

  it("two separate limiter instances (two 'isolates') share one cumulative count", async () => {
    const bucket = `test-shared-${Date.now()}`;
    const buildApp = () => {
      const limiter = makeDbLimiter({
        bucket,
        windowMs: 60_000,
        limit: 3,
        message: "slow down",
        shape: "error",
        failClosed: true,
      });
      const app = new Hono();
      app.get("/x", limiter, (c) => c.text("ok"));
      return app;
    };

    // Two independently constructed limiter closures/apps — nothing shared
    // in JS memory between them, only the DB row the bucket/key/window
    // resolves to.
    const isolateA = buildApp();
    const isolateB = buildApp();

    expect(await hit(isolateA)).toBe(200); // count -> 1
    expect(await hit(isolateB)).toBe(200); // count -> 2 (isolate B sees isolate A's count)
    expect(await hit(isolateA)).toBe(200); // count -> 3
    expect(await hit(isolateB)).toBe(429); // count -> 4, over the limit of 3
    expect(await hit(isolateA)).toBe(429); // still blocked
  });

  it("different keys under the same bucket/window are counted independently", async () => {
    const bucket = `test-perkey-${Date.now()}`;
    const limiter = makeDbLimiter({ bucket, windowMs: 60_000, limit: 1, message: "slow down", shape: "error", failClosed: true });
    const app = new Hono();
    app.get("/x", limiter, (c) => c.text("ok"));

    const resA1 = await app.request("http://test/x", { headers: { "cf-connecting-ip": "203.0.113.10" } });
    const resA2 = await app.request("http://test/x", { headers: { "cf-connecting-ip": "203.0.113.10" } });
    const resB1 = await app.request("http://test/x", { headers: { "cf-connecting-ip": "203.0.113.11" } });

    expect(resA1.status).toBe(200);
    expect(resA2.status).toBe(429); // same IP, second request in the window
    expect(resB1.status).toBe(200); // different IP, its own count
  });
});

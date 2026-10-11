import { describe, expect, it, beforeAll } from "vitest";
import { getTestWorkerApp, WorkerAgent } from "../helpers/testWorkerApp.js";

// Plain fetch-handler tests (vitest, Node environment) against the Cloudflare
// Worker's own Hono `app.fetch` export — not @cloudflare/vitest-pool-workers,
// per the port job's "vitest + ... or plain fetch-handler tests" option.
// Same PGlite-backed harness the Express build's tests already use (no
// DATABASE_URL in vitest.config.ts's env block -> src/server/db/client.ts
// falls back to the embedded PGlite path, unchanged by this port).
describe("worker: healthz + auth", () => {
  let worker: Awaited<ReturnType<typeof getTestWorkerApp>>;

  beforeAll(async () => {
    worker = await getTestWorkerApp();
  });

  it("GET /healthz and /api/health are open, unauthenticated", async () => {
    const agent = new WorkerAgent(worker);
    const healthz = await agent.get("/healthz");
    expect(healthz.status).toBe(200);
    expect((healthz.body as { ok: boolean }).ok).toBe(true);

    const health = await agent.get("/api/health");
    expect(health.status).toBe(200);
  });

  it("signs up, reports the session via /me, and logs out", async () => {
    const agent = new WorkerAgent(worker);
    const signup = await agent.post("/api/auth/signup", { email: "worker-auth1@example.com", password: "password123" });
    expect(signup.status).toBe(201);
    expect((signup.body as { user: { email: string } }).user.email).toBe("worker-auth1@example.com");

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect((me.body as { user: { email: string } }).user.email).toBe("worker-auth1@example.com");

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(204);

    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("rejects duplicate signups with 409 and bad login with 401", async () => {
    const agent = new WorkerAgent(worker);
    await agent.post("/api/auth/signup", { email: "worker-dupe@example.com", password: "password123" });
    const second = await agent.post("/api/auth/signup", { email: "worker-dupe@example.com", password: "password123" });
    expect(second.status).toBe(409);

    const badLogin = await agent.post("/api/auth/login", { email: "worker-dupe@example.com", password: "wrong-password" });
    expect(badLogin.status).toBe(401);
  });

  it("blocks a state-changing request without the same-origin header (requireSameOrigin)", async () => {
    const agent = new WorkerAgent(worker);
    const res = await agent.request("POST", "/api/auth/logout", { sameOrigin: false });
    expect(res.status).toBe(403);
  });

  it("a route not yet ported to the Worker 404s (moment is still Node/Render-only)", async () => {
    const agent = new WorkerAgent(worker);
    const res = await agent.get("/api/moment");
    expect(res.status).toBe(404);
  });
});

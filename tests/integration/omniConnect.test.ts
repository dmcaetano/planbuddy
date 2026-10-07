import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { HDR } from "../helpers/planJobs.js";
import { getDb } from "../../src/server/db/client.js";
import { signBody } from "../../src/server/omni/hub.js";
import { getLinkForUser } from "../../src/server/omni/repo.js";
import { env } from "../../src/server/env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SECRET = "hub-signing-secret-for-tests-0123456789";
const KEY = SECRET;
const HUB = "https://hub.example.com";
let app: any;
let seq = 0;
const realFetch = globalThis.fetch;
let hubCalls: any[] = [];

function connect(body: unknown, opts: { key?: string; ts?: number; ip?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Date.now() + (seq++ % 1000));
  return request(app)
    .post("/api/buddy/connect")
    .set("X-Forwarded-For", opts.ip ?? "10.1.1.1")
    .set("X-Omni-Timestamp", ts)
    .set("X-Omni-Signature", signBody(opts.key ?? KEY, ts, raw))
    .set("Content-Type", "application/json")
    .send(raw);
}
const body = (over: Record<string, unknown> = {}) => ({ code: "CODE1234", email: "New.Person@Example.com", email_verified: true, name: "New", locale: "en", hub_url: HUB, ...over });

beforeAll(async () => {
  app = await getTestApp();
  (env as any).OMNIBUDDY_HUB_URL = HUB;
  (env as any).OMNI_CONNECT_SECRET = SECRET;
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    if (String(url).startsWith(HUB)) {
      hubCalls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ token: "tok", link_id: "lk-" + hubCalls.length, signing_key: "sk" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, init);
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  (env as any).OMNI_CONNECT_SECRET = undefined;
});

describe("POST /api/buddy/connect", () => {
  it("rejects unsigned, wrongly signed and stale requests with 401", async () => {
    expect((await request(app).post("/api/buddy/connect").send(body())).status).toBe(401);
    expect((await connect(body(), { key: "wrong" })).status).toBe(401);
    expect((await connect(body(), { ts: Date.now() - 10 * 60_000 })).status).toBe(401);
    expect(hubCalls.length).toBe(0);
  });

  it("answers 503 when OMNI_CONNECT_SECRET is not configured", async () => {
    (env as any).OMNI_CONNECT_SECRET = undefined;
    expect((await connect(body())).status).toBe(503);
    (env as any).OMNI_CONNECT_SECRET = SECRET;
  });

  it("creates a hub-verified account, links it, and is idempotent on re-connect", async () => {
    const res = await connect(body());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(hubCalls[0].url).toBe(HUB + "/api/link/complete");
    const db = await getDb();
    const { rows } = await db.query<any>("SELECT id, hub_verified FROM users WHERE email = 'new.person@example.com'");
    expect(rows.length).toBe(1);
    expect(rows[0].hub_verified).toBe(true);
    expect(await getLinkForUser(rows[0].id)).toBeTruthy();
    expect(hubCalls[0].body.external_user_id).toBe(rows[0].id);
    const again = await connect(body({ code: "CODE5678" }));
    expect(again.status).toBe(200);
    const n = await db.query<any>("SELECT COUNT(*)::int AS n FROM users WHERE email = 'new.person@example.com'");
    expect(n.rows[0].n).toBe(1);
    expect(hubCalls[1].body.external_user_id).toBe(rows[0].id);
  });

  it("refuses a replayed request", async () => {
    const raw = JSON.stringify(body({ code: "REPLAY99" }));
    const ts = String(Date.now());
    const send = () => request(app).post("/api/buddy/connect").set("X-Omni-Timestamp", ts).set("X-Omni-Signature", signBody(KEY, ts, raw)).set("Content-Type", "application/json").send(raw);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(401);
  });

  it("refuses an existing self-registered (unverified) account: manual_required, nothing linked", async () => {
    const agent = request.agent(app);
    const s = await agent.post("/api/auth/signup").set(HDR, "1").send({ email: "victim@example.com", password: "password123" });
    const before = hubCalls.length;
    const res = await connect(body({ email: "victim@example.com" }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, reason: "manual_required" });
    expect(hubCalls.length).toBe(before);
    expect(await getLinkForUser(s.body.user.id)).toBeNull();
  });

  it("refuses email_verified other than true", async () => {
    const before = hubCalls.length;
    for (const v of [false, "true", undefined]) {
      const res = await connect(body({ email: "x@example.com", email_verified: v }));
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe("not_verified");
    }
    expect(hubCalls.length).toBe(before);
  });

  it("never uses a hub_url from the body", async () => {
    const before = hubCalls.length;
    const res = await connect(body({ email: "y@example.com", hub_url: "https://evil.example.com" }));
    expect(res.status).toBe(400);
    expect(hubCalls.length).toBe(before);
  });
});

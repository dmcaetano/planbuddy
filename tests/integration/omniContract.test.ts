import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { HDR, waitForJob } from "../helpers/planJobs.js";
import { getDb } from "../../src/server/db/client.js";
import { localNow } from "../../src/server/omni/card.js";
import { buildPushItems, formatContextBlock, signBody, verifySignature } from "../../src/server/omni/hub.js";
import { saveLink } from "../../src/server/omni/repo.js";
import { createConstraint } from "../../src/server/memory/constraints.repo.js";
import { createTaste } from "../../src/server/memory/tastes.repo.js";

const KEY = "test-signing-key-0123456789";
const LINK = "link-test-1";

/* eslint-disable @typescript-eslint/no-explicit-any */
let app: any;
let agent: ReturnType<typeof request.agent>;
let userId: string;

function signed(method: "get" | "post", path: string, body?: unknown, opts: { key?: string; ts?: number; link?: string } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(opts.ts ?? Date.now());
  const sig = signBody(opts.key ?? KEY, ts, raw);
  const r = request(app)[method](path).set("X-Omni-Timestamp", ts).set("X-Omni-Link", opts.link ?? LINK).set("X-Omni-Signature", sig);
  return body === undefined ? r : r.set("Content-Type", "application/json").send(raw);
}

beforeAll(async () => {
  app = await getTestApp();
  agent = request.agent(app);
  agent.set("X-Forwarded-For", "10.9.9.9");
  const signup = await agent.post("/api/auth/signup").set(HDR, "1").send({ email: "omni@example.com", password: "password123" });
  userId = signup.body.user.id;
  await agent.put("/api/auth/home-base").set(HDR, "1").send({ label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 });
  await saveLink({ userId, linkId: LINK, hubToken: "hub-token", signingKey: KEY, hubUrl: "https://hub.example.com" } as any);
});

describe("Buddy Contract v1: health", () => {
  it("is open and reports version + contract", async () => {
    const res = await request(app).get("/api/buddy/health");
    expect(res.status).toBe(200);
    expect(res.body.contract).toBe(1);
    expect(typeof res.body.version).toBe("string");
  });
});

describe("Buddy Contract v1: signatures", () => {
  it("rejects unsigned, wrongly signed, stale and unknown-link requests", async () => {
    expect((await request(app).get("/api/buddy/card")).status).toBe(401);
    expect((await signed("get", "/api/buddy/card", undefined, { key: "wrong" })).status).toBe(401);
    expect((await signed("get", "/api/buddy/card", undefined, { ts: Date.now() - 10 * 60_000 })).status).toBe(401);
    expect((await signed("get", "/api/buddy/card", undefined, { link: "nope" })).status).toBe(401);
    expect((await signed("post", "/api/buddy/act", { action: "primary" }, { key: "wrong" })).status).toBe(401);
    expect((await signed("post", "/api/buddy/suggest", { entity: { type: "cuisine", canonical: "italian" } }, { key: "wrong" })).status).toBe(401);
  });

  it("verifySignature is skew-limited and rejects tampered bodies", () => {
    const ts = String(Date.now());
    const sig = signBody(KEY, ts, "{}");
    expect(verifySignature(KEY, ts, sig, "{}")).toBe(true);
    expect(verifySignature(KEY, ts, sig, "{ }")).toBe(false);
    expect(verifySignature(KEY, undefined, sig, "{}")).toBe(false);
  });
});

describe("Buddy Contract v1: card, act, undo", () => {
  it("card is needs_data before any plan exists, and creates nothing", async () => {
    const res = await signed("get", "/api/buddy/card");
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("needs_data");
    const db = await getDb();
    const { rows } = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM plans WHERE user_id = $1", [userId]);
    expect(rows[0].n).toBe(0);
  });

  it("offers to lock a real suggested plan, locks it, and undo restores it", async () => {
    const open = await agent.post("/api/moment").set(HDR, "1").send({ localDateTime: localNow() });
    expect(open.status).toBe(200);
    if (open.body.status === "generating") {
      const job = await waitForJob(agent, open.body.jobId);
      expect(job.status).toBe("succeeded");
    }

    const card = await signed("get", "/api/buddy/card");
    expect(card.body.state).toBe("ready");
    expect(card.body.primaryAction.id).toBe("lock_plan");
    expect(card.body.primaryAction.label).toMatch(/Lock/);
    expect(card.body.title.length).toBeGreaterThan(3);

    const act = await signed("post", "/api/buddy/act", { action: "primary", actionId: "lock_plan" });
    expect(act.status).toBe(200);
    expect(act.body.ok).toBe(true);
    expect(act.body.undoToken).toBeTruthy();

    const locked = await signed("get", "/api/buddy/card");
    expect(locked.body.primaryAction.id).toBe("view_plan");

    const undo = await signed("post", "/api/buddy/act", { action: "undo", undoToken: act.body.undoToken });
    expect(undo.body.ok).toBe(true);
    const again = await signed("post", "/api/buddy/act", { action: "undo", undoToken: act.body.undoToken });
    expect(again.status).toBe(400);
    expect(again.body.ok).toBe(false);

    const back = await signed("get", "/api/buddy/card");
    expect(back.body.primaryAction.id).toBe("lock_plan");
  });

  it("accept stores a taste that undo removes, and never echoes back to the hub", async () => {
    const act = await signed("post", "/api/buddy/act", { action: "accept", candidate: { title: "Planetário", where: "Belém" } });
    expect(act.body.ok).toBe(true);
    expect((await buildPushItems(userId)).some((i) => i.text.startsWith("Wants to try:"))).toBe(false);
    const undo = await signed("post", "/api/buddy/act", { action: "undo", undoToken: act.body.undoToken });
    expect(undo.body.ok).toBe(true);
  });
});

describe("Buddy Contract v1: suggest", () => {
  it("returns only verified candidates, and an empty list for what it cannot verify", async () => {
    const unknown = await signed("post", "/api/buddy/suggest", { entity: { type: "artist", canonical: "Some Made Up Band" } });
    expect(unknown.body.candidates).toEqual([]);
    const food = await signed("post", "/api/buddy/suggest", { entity: { type: "cuisine", canonical: "italian" } });
    expect(Array.isArray(food.body.candidates)).toBe(true);
    for (const c of food.body.candidates) expect(c.verified_source).toBeTruthy();
  });
});

describe("Buddy Contract v1: link", () => {
  it("answers JSON {ok:false} (never 5xx) for an invalid code", async () => {
    const res = await agent.post("/api/buddy/link").set(HDR, "1").send({ code: "bogus" });
    expect(res.status).toBeLessThan(500);
    expect(res.body.ok).toBe(false);
    const anon = await request(app).post("/api/buddy/link").set(HDR, "1").send({ code: "bogus" });
    expect(anon.status).toBe(401);
    expect(anon.body.ok).toBe(false);
  });
});

describe("shared memory", () => {
  it("never makes constraints or health-like tastes family-visible", async () => {
    await createConstraint(userId, { participantId: null, text: "Celiac, no gluten", status: "verified", source: "chat", sourceQuote: "I am celiac" } as any);
    await createTaste(userId, { participantId: null, text: "Severe peanut allergy", polarity: "avoid", source: "stated" });
    await createTaste(userId, { participantId: null, text: "Loves sunset viewpoints", polarity: "love", source: "stated" });
    const items = await buildPushItems(userId);
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const i of items) {
      if (i.origin_item_id.startsWith("constraint:") || /allerg|gluten/i.test(i.text)) {
        expect(i.visibility).toBe("app_only");
        expect(["safety", "health"]).toContain(i.sensitivity);
      }
    }
    expect(items.find((i) => /sunset/.test(i.text))?.visibility).toBe("family");
  });

  it("formats the context block with a source Buddy on every line", () => {
    const block = formatContextBlock([
      { origin_app: "streambuddy", text: "Likes space documentaries", status: "fact", sentiment: "positive", quote: null },
      { origin_app: "planbuddy", text: "own item", status: "fact", sentiment: "positive", quote: null },
    ]);
    expect(block).toContain("=== FROM YOUR OTHER BUDDIES (shared by you) ===");
    expect(block).toContain("[StreamBuddy] Likes space documentaries");
    expect(block).not.toContain("own item");
    expect(formatContextBlock([])).toBe("");
  });
});

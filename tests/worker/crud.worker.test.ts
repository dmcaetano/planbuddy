import { describe, expect, it, beforeAll } from "vitest";
import { getTestWorkerApp, WorkerAgent } from "../helpers/testWorkerApp.js";

describe("worker: CRUD route modules (phase 3)", () => {
  let worker: Awaited<ReturnType<typeof getTestWorkerApp>>;

  beforeAll(async () => {
    worker = await getTestWorkerApp();
  });

  async function signedUpAgent(email: string) {
    const agent = new WorkerAgent(worker);
    await agent.post("/api/auth/signup", { email, password: "password123" });
    return agent;
  }

  it("participants: lists the seeded owner, requires auth", async () => {
    const anon = new WorkerAgent(worker);
    const anonList = await anon.get("/api/participants");
    expect(anonList.status).toBe(401);

    const agent = await signedUpAgent("worker-participants@example.com");
    const list = await agent.get("/api/participants");
    expect(list.status).toBe(200);
    const participants = (list.body as { participants: Array<{ isOwner: boolean }> }).participants;
    expect(participants.some((p) => p.isOwner)).toBe(true);
  });

  it("constraints: create, list, confirm, delete round-trip", async () => {
    const agent = await signedUpAgent("worker-constraints@example.com");
    const created = await agent.post("/api/constraints", { text: "No seafood" });
    expect(created.status).toBe(201);
    const id = (created.body as { constraint: { id: string } }).constraint.id;

    const list = await agent.get("/api/constraints");
    expect(list.status).toBe(200);
    expect((list.body as { constraints: unknown[] }).constraints).toHaveLength(1);

    const confirmed = await agent.post(`/api/constraints/${id}/confirm`);
    expect(confirmed.status).toBe(200);

    const deleted = await agent.delete(`/api/constraints/${id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await agent.get("/api/constraints");
    expect((afterDelete.body as { constraints: unknown[] }).constraints).toHaveLength(0);
  });

  it("tastes: create + list", async () => {
    const agent = await signedUpAgent("worker-tastes@example.com");
    const created = await agent.post("/api/tastes", { text: "Loves jazz bars", polarity: "love" });
    expect(created.status).toBe(201);
    const list = await agent.get("/api/tastes");
    expect((list.body as { tastes: unknown[] }).tastes).toHaveLength(1);
  });

  it("hunches: empty list for a fresh account", async () => {
    const agent = await signedUpAgent("worker-hunches@example.com");
    const list = await agent.get("/api/hunches");
    expect(list.status).toBe(200);
    expect((list.body as { hunches: unknown[] }).hunches).toEqual([]);
  });

  it("plan-jobs: active is null for a fresh account, unknown id 404s", async () => {
    const agent = await signedUpAgent("worker-jobs@example.com");
    const active = await agent.get("/api/plan-jobs/active");
    expect(active.status).toBe(200);
    expect((active.body as { job: unknown }).job).toBeNull();

    const missing = await agent.get("/api/plan-jobs/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });

  it("time-off: create + list", async () => {
    const agent = await signedUpAgent("worker-timeoff@example.com");
    const created = await agent.post("/api/time-off", { label: "Christmas trip", startDate: "2026-12-20", endDate: "2026-12-27" });
    expect(created.status).toBe(201);
    const list = await agent.get("/api/time-off");
    expect((list.body as { timeOff: unknown[] }).timeOff).toHaveLength(1);
  });

  it("history: empty buckets for a fresh account", async () => {
    const agent = await signedUpAgent("worker-history@example.com");
    const list = await agent.get("/api/history");
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ suggested: [], upcoming: [], past: [] });
  });

  it("friends: empty list + labels for a fresh account", async () => {
    const agent = await signedUpAgent("worker-friends@example.com");
    const list = await agent.get("/api/friends");
    expect((list.body as { friends: unknown[] }).friends).toEqual([]);
    const labels = await agent.get("/api/friends/labels");
    expect((labels.body as { labels: unknown[] }).labels).toEqual([]);
  });
});

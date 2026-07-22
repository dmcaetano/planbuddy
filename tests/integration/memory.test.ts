import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { recordHunchEvidence } from "../../src/server/memory/hunches.repo.js";

const HDR = "X-PlanBuddy-Client";

async function signUp(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const res = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  return { agent, userId: res.body.user.id as string };
}

describe("memory integration", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("creates a typed constraint as immediately verified", async () => {
    const { agent } = await signUp(app, "mem1@example.com");
    const res = await agent.post("/api/constraints").set(HDR, "1").send({ text: "No shellfish — allergy" });
    expect(res.status).toBe(201);
    expect(res.body.constraint.status).toBe("verified");
    expect(res.body.constraint.source).toBe("typed");
  });

  it("supports full constraint CRUD", async () => {
    const { agent } = await signUp(app, "mem2@example.com");
    const created = await agent.post("/api/constraints").set(HDR, "1").send({ text: "No stairs" });
    const id = created.body.constraint.id;

    const updated = await agent.patch(`/api/constraints/${id}`).set(HDR, "1").send({ text: "No stairs, wheelchair user" });
    expect(updated.status).toBe(200);
    expect(updated.body.constraint.text).toBe("No stairs, wheelchair user");

    const list = await agent.get("/api/constraints");
    expect(list.body.constraints.some((c: { id: string }) => c.id === id)).toBe(true);

    const del = await agent.delete(`/api/constraints/${id}`).set(HDR, "1");
    expect(del.status).toBe(204);

    const listAfter = await agent.get("/api/constraints");
    expect(listAfter.body.constraints.some((c: { id: string }) => c.id === id)).toBe(false);
  });

  it("supports full taste CRUD", async () => {
    const { agent } = await signUp(app, "mem3@example.com");
    const created = await agent.post("/api/tastes").set(HDR, "1").send({ text: "loves live music", polarity: "love" });
    expect(created.status).toBe(201);
    const id = created.body.taste.id;

    const updated = await agent.patch(`/api/tastes/${id}`).set(HDR, "1").send({ weight: 0.9 });
    expect(updated.body.taste.weight).toBe(0.9);

    const del = await agent.delete(`/api/tastes/${id}`).set(HDR, "1");
    expect(del.status).toBe(204);
  });

  it("returns 404 (not leaking existence) when accessing another tenant's constraint", async () => {
    const { agent: agentA } = await signUp(app, "tenantA@example.com");
    const { agent: agentB } = await signUp(app, "tenantB@example.com");

    const created = await agentA.post("/api/constraints").set(HDR, "1").send({ text: "No peanuts" });
    const id = created.body.constraint.id;

    const crossRead = await agentB.patch(`/api/constraints/${id}`).set(HDR, "1").send({ text: "hijacked" });
    expect(crossRead.status).toBe(404);

    const crossDelete = await agentB.delete(`/api/constraints/${id}`).set(HDR, "1");
    expect(crossDelete.status).toBe(404);
  });

  it("does not expose hunch evidence across tenants", async () => {
    const { agent: agentA, userId } = await signUp(app, "hunch-owner@example.com");
    const { agent: agentB } = await signUp(app, "hunch-other@example.com");
    const hunch = await recordHunchEvidence(userId, {
      participantId: null,
      text: "quiet mornings",
      polarity: "love",
      note: "private feedback detail",
    });

    const ownerRead = await agentA.get(`/api/hunches/${hunch.id}/evidence`);
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body.evidence).toHaveLength(1);

    const crossTenantRead = await agentB.get(`/api/hunches/${hunch.id}/evidence`);
    expect(crossTenantRead.status).toBe(404);
  });

  it("lets the owner edit and permanently delete a learned hunch", async () => {
    const { agent, userId } = await signUp(app, "hunch-crud@example.com");
    const hunch = await recordHunchEvidence(userId, {
      participantId: null,
      text: "busy restaurants",
      polarity: "avoid",
      note: "learned from a dislike",
    });

    const updated = await agent.patch(`/api/hunches/${hunch.id}`).set(HDR, "1").send({
      text: "very noisy restaurants",
      polarity: "avoid",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.hunch.text).toBe("very noisy restaurants");

    const deleted = await agent.delete(`/api/hunches/${hunch.id}`).set(HDR, "1");
    expect(deleted.status).toBe(204);
    const list = await agent.get("/api/hunches");
    expect(list.body.hunches.some((item: { id: string }) => item.id === hunch.id)).toBe(false);
  });

  it("chat quote-or-demote: verified quote becomes an active-unverified constraint", async () => {
    const { agent } = await signUp(app, "chatquote1@example.com");
    const session = await agent.get("/api/chat/session");
    const sessionId = session.body.session.id;

    const content = "We are allergic to peanuts";
    const res = await agent.post(`/api/chat/session/${sessionId}/messages`).set(HDR, "1").send({ content });
    expect(res.status).toBe(201);
    expect(res.body.memoryUpdates.some((u: { kind: string; verified: boolean }) => u.kind === "constraint" && u.verified)).toBe(true);

    const constraints = await agent.get("/api/constraints");
    const created = constraints.body.constraints.find((c: { source: string }) => c.source === "chat");
    expect(created).toBeTruthy();
    expect(created.status).toBe("active_unverified");
    expect(content.includes(created.sourceQuote)).toBe(true);
  });

  it("confirming an active-unverified constraint promotes it to verified", async () => {
    const { agent } = await signUp(app, "chatquote2@example.com");
    const session = await agent.get("/api/chat/session");
    const sessionId = session.body.session.id;
    await agent.post(`/api/chat/session/${sessionId}/messages`).set(HDR, "1").send({ content: "We are allergic to peanuts" });

    const constraints = await agent.get("/api/constraints");
    const created = constraints.body.constraints.find((c: { source: string }) => c.source === "chat");

    const confirmed = await agent.post(`/api/constraints/${created.id}/confirm`).set(HDR, "1");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.constraint.status).toBe("verified");
  });
});

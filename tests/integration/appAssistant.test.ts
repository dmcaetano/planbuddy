import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { applyAppActions, buildAppSnapshot, composeAssistantReply } from "../../src/server/chat/appAssistant.js";
import { planActionInterpret } from "../../src/server/ai/index.js";
import type { Candidate } from "../../src/shared/types.js";

const HDR = "X-PlanBuddy-Client";

async function signUp(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const res = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  return { agent, userId: res.body.user.id as string };
}

type Agent = Awaited<ReturnType<typeof signUp>>["agent"];

async function replay(agent: Agent, undo: { method: string; path: string; body?: unknown }) {
  const url = `/api${undo.path}`;
  const call =
    undo.method === "DELETE" ? agent.delete(url)
    : undo.method === "POST" ? agent.post(url)
    : undo.method === "PUT" ? agent.put(url)
    : agent.patch(url);
  return call.set(HDR, "1").send(undo.body as object | undefined);
}

describe("Buddy app assistant", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  it("adds a taste, constraint and person, and every undo descriptor really reverses it over REST", async () => {
    const { agent, userId } = await signUp(app, "assistant-add@example.com");
    const result = await applyAppActions(
      userId,
      [
        { type: "add_taste", text: "quiet beaches", polarity: "love" },
        { type: "add_constraint", text: "no stairs" },
        { type: "add_person", name: "Rex", kind: "pet", relationship: "dog" },
      ],
      "add quiet beaches, no stairs and my dog Rex"
    );
    expect(result.failed).toEqual([]);
    expect(result.applied).toHaveLength(3);

    const tastes = await agent.get("/api/tastes");
    expect(tastes.body.tastes.map((t: { text: string }) => t.text)).toContain("quiet beaches");
    const people = await agent.get("/api/participants");
    expect(people.body.participants.some((p: { name: string; relationship: string }) => p.name === "Rex" && p.relationship === "dog")).toBe(true);

    for (const change of result.applied) {
      expect(change.undo).not.toBeNull();
      const res = await replay(agent, change.undo!);
      expect(res.status).toBeLessThan(300);
    }
    expect((await agent.get("/api/tastes")).body.tastes).toHaveLength(0);
    expect((await agent.get("/api/constraints")).body.constraints).toHaveLength(0);
    expect((await agent.get("/api/participants")).body.participants.some((p: { name: string }) => p.name === "Rex")).toBe(false);
  });

  it("removing a taste is undoable and brings the same taste back", async () => {
    const { agent, userId } = await signUp(app, "assistant-remove@example.com");
    const created = await agent.post("/api/tastes").set(HDR, "1").send({ text: "jazz", polarity: "love" });
    const id = created.body.taste.id as string;
    const result = await applyAppActions(userId, [{ type: "remove_taste", id }], "remove jazz");
    expect(result.applied).toHaveLength(1);
    expect((await agent.get("/api/tastes")).body.tastes).toHaveLength(0);
    const undone = await replay(agent, result.applied[0].undo!);
    expect(undone.status).toBe(201);
    expect((await agent.get("/api/tastes")).body.tastes.map((t: { text: string }) => t.text)).toEqual(["jazz"]);
  });

  it("changes travel distance, returns the updated user, and undo restores the previous values", async () => {
    const { agent, userId } = await signUp(app, "assistant-travel@example.com");
    const result = await applyAppActions(userId, [{ type: "set_travel", dayKm: 40, weekendKm: 120 }], "go up to 40 km");
    expect(result.user?.travelDayKm).toBe(40);
    expect(result.user?.travelWeekendKm).toBe(120);
    const undone = await replay(agent, result.applied[0].undo!);
    expect(undone.status).toBe(200);
    expect(undone.body.user.travelDayKm).toBe(25);
    expect(undone.body.user.travelWeekendKm).toBe(60);
  });

  it("manages time off, rejecting invalid dates without writing anything", async () => {
    const { agent, userId } = await signUp(app, "assistant-timeoff@example.com");
    const bad = await applyAppActions(userId, [{ type: "add_time_off", label: "Break", startDate: "2026-12-31", endDate: "2026-12-24" }], "x");
    expect(bad.applied).toHaveLength(0);
    expect(bad.failed).toHaveLength(1);
    expect((await agent.get("/api/time-off")).body.timeOff).toHaveLength(0);

    const ok = await applyAppActions(userId, [{ type: "add_time_off", label: "Christmas", startDate: "2026-12-24", endDate: "2026-12-31" }], "x");
    expect(ok.applied).toHaveLength(1);
    const list = (await agent.get("/api/time-off")).body.timeOff as { id: string }[];
    expect(list).toHaveLength(1);
    const update = await applyAppActions(userId, [{ type: "update_time_off", id: list[0].id, endDate: "2027-01-02" }], "x");
    expect(update.applied[0].label).toContain("2027-01-02");
    const removed = await applyAppActions(userId, [{ type: "remove_time_off", id: list[0].id }], "x");
    expect(removed.applied).toHaveLength(1);
    expect((await agent.get("/api/time-off")).body.timeOff).toHaveLength(0);
  });

  it("never touches another user's rows or the owner entry, and unknown ids fail cleanly", async () => {
    const a = await signUp(app, "assistant-tenant-a@example.com");
    const b = await signUp(app, "assistant-tenant-b@example.com");
    const taste = await b.agent.post("/api/tastes").set(HDR, "1").send({ text: "private", polarity: "avoid" });
    const owner = (await a.agent.get("/api/participants")).body.participants.find((p: { isOwner: boolean }) => p.isOwner) as { id: string };

    const result = await applyAppActions(
      a.userId,
      [
        { type: "remove_taste", id: taste.body.taste.id },
        { type: "remove_person", id: owner.id },
        { type: "remove_constraint", id: "does-not-exist" },
        { type: "add_taste", text: "x", polarity: "love", personName: "Nobody" },
      ],
      "x"
    );
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(4);
    expect((await b.agent.get("/api/tastes")).body.tastes).toHaveLength(1);
    expect((await a.agent.get("/api/participants")).body.participants.some((p: { isOwner: boolean }) => p.isOwner)).toBe(true);
  });

  it("builds a snapshot with the user's own ids and no other user's data", async () => {
    const a = await signUp(app, "assistant-snap-a@example.com");
    const b = await signUp(app, "assistant-snap-b@example.com");
    await b.agent.post("/api/tastes").set(HDR, "1").send({ text: "secret-b-taste", polarity: "love" });
    await a.agent.post("/api/participants").set(HDR, "1").send({ name: "Dani", kind: "person", relationship: "wife" });
    const snapshot = await buildAppSnapshot(a.userId);
    expect(snapshot).toContain("Dani");
    expect(snapshot).not.toContain("secret-b-taste");
  });

  it("keeps the reply honest when nothing was applied", () => {
    const reply = composeAssistantReply("Done, removed it.", 1, { applied: [], failed: ["I couldn't find that taste"], user: null });
    expect(reply).toContain("couldn't make that change");
    expect(reply).not.toContain("Done");
    expect(composeAssistantReply("Hello", 0, { applied: [], failed: [], user: null })).toBe("Hello");
  });

  it("routes app and circle questions out of the plan lane even when a plan is in view", async () => {
    const candidate = { title: "Dinner", category: "dinner", walkingMinutes: 20, estimatedCost: null, beats: [] } as unknown as Candidate;
    const circle = await planActionInterpret("Who are the people in my circle?", candidate);
    expect(circle.response.action).toBe("app");
    const settings = await planActionInterpret("Set my distance to 40 km", candidate);
    expect(settings.response.action).toBe("app");
    const edit = await planActionInterpret("Make this plan cheaper", candidate);
    expect(edit.response.action).not.toBe("app");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { getDb } from "../../src/server/db/client.js";
import { HDR } from "../helpers/planJobs.js";

let ipCounter = 40;

async function account(app: unknown, email: string) {
  const ip = `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  ipCounter += 1;
  const agent = request.agent(app as never);
  agent.set("X-Forwarded-For", ip);
  const signup = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  return { agent, userId: signup.body.user.id as string };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function add(who: Awaited<ReturnType<typeof account>>, body: Record<string, unknown>) {
  return who.agent.post("/api/time-off").set(HDR, "1").send(body);
}

describe("/api/time-off", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  it("requires a session", async () => {
    const anon = request.agent(app as never);
    anon.set("X-Forwarded-For", "10.8.200.1");
    expect((await anon.get("/api/time-off")).status).toBe(401);
  });

  it("creates, lists, updates and deletes a range", async () => {
    const who = await account(app, "timeoff-crud@example.com");
    expect((await who.agent.get("/api/time-off")).body.timeOff).toEqual([]);

    const created = await add(who, { label: "  Christmas ", startDate: "2026-12-24", endDate: "2026-12-31" });
    expect(created.status).toBe(201);
    expect(created.body.timeOff).toMatchObject({ label: "Christmas", startDate: "2026-12-24", endDate: "2026-12-31", snoozedUntil: null });
    const id = created.body.timeOff.id as string;

    await add(who, { label: "Easter", startDate: "2026-04-02", endDate: "2026-04-06" });
    const listed = await who.agent.get("/api/time-off");
    expect(listed.body.timeOff.map((t: { label: string }) => t.label)).toEqual(["Easter", "Christmas"]);

    const edited = await who.agent.patch(`/api/time-off/${id}`).set(HDR, "1").send({ label: "Xmas", endDate: "2027-01-02" });
    expect(edited.status).toBe(200);
    expect(edited.body.timeOff).toMatchObject({ label: "Xmas", startDate: "2026-12-24", endDate: "2027-01-02" });

    const removed = await who.agent.delete(`/api/time-off/${id}`).set(HDR, "1");
    expect(removed.status).toBe(204);
    expect((await who.agent.get("/api/time-off")).body.timeOff).toHaveLength(1);
    expect((await who.agent.delete(`/api/time-off/${id}`).set(HDR, "1")).status).toBe(404);
  });

  it("validates labels and dates", async () => {
    const who = await account(app, "timeoff-validate@example.com");
    const bad: Record<string, unknown>[] = [
      {},
      { label: "", startDate: "2026-12-24", endDate: "2026-12-31" },
      { label: "x".repeat(81), startDate: "2026-12-24", endDate: "2026-12-31" },
      { label: "Trip", startDate: "2026-12-31", endDate: "2026-12-24" },
      { label: "Trip", startDate: "2026-02-30", endDate: "2026-03-02" },
      { label: "Trip", startDate: "24/12/2026", endDate: "31/12/2026" },
    ];
    for (const body of bad) {
      const res = await add(who, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await add(who, { label: "x".repeat(80), startDate: "2026-12-24", endDate: "2026-12-24" })).status).toBe(201);

    const created = await add(who, { label: "Trip", startDate: "2026-12-24", endDate: "2026-12-31" });
    const id = created.body.timeOff.id as string;
    // A partial edit is validated against the stored other bound.
    const inverted = await who.agent.patch(`/api/time-off/${id}`).set(HDR, "1").send({ endDate: "2026-12-01" });
    expect(inverted.status).toBe(400);
    expect((await who.agent.patch(`/api/time-off/${id}`).set(HDR, "1").send({ startDate: "2027-01-05" })).status).toBe(400);
    expect((await who.agent.patch(`/api/time-off/${id}`).set(HDR, "1").send({ label: "" })).status).toBe(400);
  });

  it("returns 404 for another tenant on every route", async () => {
    const a = await account(app, "timeoff-ten-a@example.com");
    const b = await account(app, "timeoff-ten-b@example.com");
    const created = await add(a, { label: "Mine", startDate: "2026-12-24", endDate: "2026-12-31" });
    const id = created.body.timeOff.id as string;

    expect((await b.agent.patch(`/api/time-off/${id}`).set(HDR, "1").send({ label: "Stolen" })).status).toBe(404);
    expect((await b.agent.delete(`/api/time-off/${id}`).set(HDR, "1")).status).toBe(404);
    expect((await b.agent.post(`/api/time-off/${id}/snooze`).set(HDR, "1").send({})).status).toBe(404);
    expect((await b.agent.post(`/api/time-off/${id}/unsnooze`).set(HDR, "1").send({})).status).toBe(404);
    expect((await b.agent.post(`/api/time-off/${id}/ideas`).set(HDR, "1").send({})).status).toBe(404);
    expect((await b.agent.get("/api/time-off")).body.timeOff).toEqual([]);
    expect((await a.agent.get("/api/time-off")).body.timeOff[0].label).toBe("Mine");
  });

  it("snoozes for 7 days from the device-local date, and shows again", async () => {
    const who = await account(app, "timeoff-snooze@example.com");
    const id = (await add(who, { label: "Trip", startDate: "2026-12-24", endDate: "2026-12-31" })).body.timeOff.id as string;

    const snoozed = await who.agent.post(`/api/time-off/${id}/snooze`).set(HDR, "1").send({ localDate: "2026-10-07" });
    expect(snoozed.status).toBe(200);
    expect(snoozed.body.timeOff.snoozedUntil).toBe("2026-10-14");

    // Month boundary arithmetic.
    const later = await who.agent.post(`/api/time-off/${id}/snooze`).set(HDR, "1").send({ localDate: "2026-10-28" });
    expect(later.body.timeOff.snoozedUntil).toBe("2026-11-04");

    // No body at all: defaults to the server date, seven days on.
    const defaulted = await who.agent.post(`/api/time-off/${id}/snooze`).set(HDR, "1");
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.timeOff.snoozedUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect((await who.agent.post(`/api/time-off/${id}/snooze`).set(HDR, "1").send({ localDate: "nope" })).status).toBe(400);

    const shown = await who.agent.post(`/api/time-off/${id}/unsnooze`).set(HDR, "1");
    expect(shown.status).toBe(200);
    expect(shown.body.timeOff.snoozedUntil).toBeNull();
  });

  it("editing a range clears the snooze and the cached ideas", async () => {
    const who = await account(app, "timeoff-edit@example.com");
    const id = (await add(who, { label: "Trip", startDate: "2026-12-24", endDate: "2026-12-31" })).body.timeOff.id as string;
    await who.agent.post(`/api/time-off/${id}/snooze`).set(HDR, "1").send({ localDate: "2026-10-07" });
    const ideas = await who.agent.post(`/api/time-off/${id}/ideas`).set(HDR, "1").send({});
    expect(ideas.status).toBe(200);
    expect(ideas.body.ideas).toHaveLength(2);

    const db = await getDb();
    const count = async () =>
      (await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM trip_ideas WHERE life_date_id = $1", [id])).rows[0].n;
    expect(await count()).toBe(1);

    const edited = await who.agent.patch(`/api/time-off/${id}`).set(HDR, "1").send({ endDate: "2027-01-03" });
    expect(edited.body.timeOff.snoozedUntil).toBeNull();
    expect(await count()).toBe(0);
  });

  it("the ideas endpoint returns a local and a farther idea, and different ones on a second ask", async () => {
    const who = await account(app, "timeoff-ideas@example.com");
    const id = (await add(who, { label: "Trip", startDate: "2026-12-24", endDate: "2026-12-31" })).body.timeOff.id as string;
    const first = await who.agent.post(`/api/time-off/${id}/ideas`).set(HDR, "1").send({});
    expect(first.body.ideas.map((i: { scope: string }) => i.scope)).toEqual(["getaway", "vacation"]);
    const second = await who.agent.post(`/api/time-off/${id}/ideas`).set(HDR, "1").send({});
    expect(second.body.ideas[0].name).not.toBe(first.body.ideas[0].name);
    expect(second.body.ideas[1].name).not.toBe(first.body.ideas[1].name);
  });
});

describe("Buddy add_time_off confirm chip", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  async function say(who: Awaited<ReturnType<typeof account>>, content: string) {
    const session = await who.agent.get("/api/chat/session");
    return who.agent.post(`/api/chat/session/${session.body.session.id}/messages`).set(HDR, "1").send({ content });
  }

  it("proposes without writing, and saves only through the confirm endpoint", async () => {
    const who = await account(app, "timeoff-buddy@example.com");
    const res = await say(who, "I have vacation from 2026-12-24 to 2026-12-31");
    expect(res.status).toBe(201);
    expect(res.body.timeOffProposal).toEqual({ label: "Vacation", startDate: "2026-12-24", endDate: "2026-12-31" });
    expect(res.body.relationshipProposal).toBeNull();
    expect(res.body.assistantMessage.content).toMatch(/Dec 24/);
    expect((await who.agent.get("/api/time-off")).body.timeOff).toEqual([]);

    const confirm = await who.agent.post("/api/chat/confirm-time-off").set(HDR, "1").send(res.body.timeOffProposal);
    expect(confirm.status).toBe(201);
    expect(confirm.body.timeOff).toMatchObject({ label: "Vacation", startDate: "2026-12-24", endDate: "2026-12-31" });
    expect((await who.agent.get("/api/time-off")).body.timeOff).toHaveLength(1);
  });

  it("proposes a plain 'I'm off Dec 24 to 31' and leaves other messages without a proposal", async () => {
    const who = await account(app, "timeoff-buddy2@example.com");
    const res = await say(who, "I'm off Dec 24 to 31");
    expect(res.body.timeOffProposal).toMatchObject({ label: "Time off" });
    expect(res.body.timeOffProposal.startDate).toMatch(/-12-24$/);
    const other = await say(who, "We love hiking");
    expect(other.body.timeOffProposal).toBeNull();
    expect((await who.agent.get("/api/time-off")).body.timeOff).toEqual([]);
  });

  it("the confirm endpoint validates and needs a session", async () => {
    const who = await account(app, "timeoff-buddy3@example.com");
    const bad = await who.agent.post("/api/chat/confirm-time-off").set(HDR, "1").send({ label: "x", startDate: "2026-12-31", endDate: "2026-12-24" });
    expect(bad.status).toBe(400);
    const anon = request.agent(app as never);
    anon.set("X-Forwarded-For", "10.8.200.2");
    expect((await anon.post("/api/chat/confirm-time-off").set(HDR, "1").send({ label: "x", startDate: "2026-12-24", endDate: "2026-12-31" })).status).toBe(401);
  });
});

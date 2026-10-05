import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { getDb } from "../../src/server/db/client.js";
import { HDR, postAndAwaitGeneration, waitForJob } from "../helpers/planJobs.js";
import { getIdeaGenerationCount } from "../../src/server/timeoff/tripIdeas.js";

// 2026-10-07 is a Wednesday, 2026-10-09 a Friday.
const WED = "2026-10-07T14:00";
const FRI_EVENING = "2026-10-09T19:00";
const RANGE = { label: "Christmas", startDate: "2026-12-24", endDate: "2026-12-31" };

let ipCounter = 60;

async function account(app: unknown, email: string) {
  const ip = `10.6.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  ipCounter += 1;
  const agent = request.agent(app as never);
  agent.set("X-Forwarded-For", ip);
  const signup = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  await agent.put("/api/auth/home-base").set(HDR, "1").send({ label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 });
  const participants = await agent.get("/api/participants");
  return { agent, userId: signup.body.user.id as string, ownerId: participants.body.participants[0].id as string };
}
type Account = Awaited<ReturnType<typeof account>>;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function open(who: Account, localDateTime: string): Promise<any> {
  const res = await who.agent.post("/api/moment").set(HDR, "1").send({ localDateTime });
  expect(res.status).toBe(200);
  return res.body;
}

async function addRange(who: Account, body: Record<string, unknown> = RANGE) {
  const res = await who.agent.post("/api/time-off").set(HDR, "1").send(body);
  expect(res.status).toBe(201);
  return res.body.timeOff as { id: string };
}

async function planRows(who: Account): Promise<number> {
  const db = await getDb();
  return (await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM plans WHERE user_id = $1", [who.userId])).rows[0].n;
}

async function lockPlan(who: Account, body: Record<string, unknown>) {
  const generated = await postAndAwaitGeneration(who.agent, "/api/plan-specs", { participantIds: [who.ownerId], ...body });
  const winner = generated.body.winner as { candidate: { id: string } };
  const spec = generated.body.spec as { id: string };
  const lock = await who.agent.post(`/api/plan-specs/${spec.id}/lock`).set(HDR, "1").send({ candidateId: winner.candidate.id });
  expect(lock.status).toBe(201);
  return generated;
}

describe("trip nudge on POST /api/moment", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  it("acceptance 11: Wednesday 14:00 leads with the nudge and two ideas", async () => {
    const who = await account(app, "nudge-wed@example.com");
    await addRange(who);
    const body = await open(who, WED);
    expect(body.moment.kind).toBe("weekend");
    expect(body.lead).toBe("nudge");
    expect(body.nudge.timeOff).toMatchObject(RANGE);
    expect(body.nudge.line).toContain("Christmas");
    expect(body.nudge.line).toContain("Dec 24");
    expect(body.nudge.ideas).toHaveLength(2);
    expect(body.nudge.ideas.map((i: { scope: string }) => i.scope)).toEqual(["getaway", "vacation"]);
    for (const idea of body.nudge.ideas) {
      expect(idea.name.length).toBeGreaterThan(1);
      expect(idea.reason.length).toBeGreaterThan(5);
    }
    if (body.jobId) await waitForJob(who.agent, body.jobId);
  });

  it("acceptance 11: Friday 19:00 keeps the dinner leading with the nudge as the smaller card", async () => {
    const who = await account(app, "nudge-fri@example.com");
    await addRange(who);
    const body = await open(who, FRI_EVENING);
    expect(body.moment.kind).toBe("tonight");
    expect(body.lead).toBe("moment");
    expect(body.nudge).not.toBeNull();
    expect(body.nudge.ideas).toHaveLength(2);
    if (body.jobId) await waitForJob(who.agent, body.jobId);
  });

  it("quotes one stored love taste on the line, with the season guard", async () => {
    const who = await account(app, "nudge-taste@example.com");
    const tasteRes = await who.agent.post("/api/tastes").set(HDR, "1").send({ text: "loves snow", polarity: "love" });
    expect(tasteRes.status).toBe(201);
    await addRange(who, RANGE);
    const july = await addRange(who, { label: "Summer", startDate: "2027-07-10", endDate: "2027-07-20" });

    const december = await open(who, WED);
    expect(december.nudge.timeOff.label).toBe("Christmas");
    expect(december.nudge.line).toContain("“loves snow”");

    // Move the December range out of the way; the July range must not cite the snow taste.
    await who.agent.post(`/api/time-off/${(december.nudge.timeOff as { id: string }).id}/snooze`).set(HDR, "1").send({ localDate: "2026-10-07" });
    await who.agent.patch(`/api/time-off/${july.id}`).set(HDR, "1").send({ startDate: "2026-11-20", endDate: "2026-11-25" });
    // 2026-11-20..25 is outside the season for beach tastes but snow is a winter taste: November is not Dec-Mar.
    const november = await open(who, WED);
    expect(november.nudge.timeOff.label).toBe("Summer");
    expect(november.nudge.line).not.toContain("loves snow");
    if (december.jobId) await waitForJob(who.agent, december.jobId);
  });

  it("acceptance 11: a locked dinner inside the range keeps the nudge; a locked getaway or vacation removes it", async () => {
    const who = await account(app, "nudge-locked@example.com");
    await addRange(who);
    await lockPlan(who, { scale: "day_off", startDate: "2026-12-26", endDate: "2026-12-26" });
    await lockPlan(who, { scale: "weekend", startDate: "2026-12-26", endDate: "2026-12-27" });
    const withDinner = await open(who, WED);
    expect(withDinner.nudge).not.toBeNull();
    if (withDinner.jobId) await waitForJob(who.agent, withDinner.jobId);

    await lockPlan(who, { scale: "getaway", startDate: "2026-12-24", endDate: "2026-12-31" });
    const withTrip = await open(who, WED);
    expect(withTrip.nudge).toBeNull();
    expect(withTrip.lead).toBe("moment");
    if (withTrip.jobId) await waitForJob(who.agent, withTrip.jobId);

    const vacationUser = await account(app, "nudge-locked-vac@example.com");
    await addRange(vacationUser);
    await lockPlan(vacationUser, { scale: "vacation", startDate: "2026-12-28", endDate: "2027-01-03" });
    const overlapping = await open(vacationUser, WED);
    expect(overlapping.nudge).toBeNull();
    if (overlapping.jobId) await waitForJob(vacationUser.agent, overlapping.jobId);
  });

  it("a locked plan covering the moment is still returned, with the nudge as the smaller card", async () => {
    const who = await account(app, "nudge-lockedmoment@example.com");
    await addRange(who);
    // Lock the plan the Friday-evening moment would show, then open again.
    const first = await open(who, FRI_EVENING);
    const job = await waitForJob(who.agent, first.jobId);
    expect(job.status).toBe("succeeded");
    const ready = await open(who, FRI_EVENING);
    const lock = await who.agent
      .post(`/api/plan-specs/${ready.plan.spec.id}/lock`)
      .set(HDR, "1")
      .send({ candidateId: ready.plan.winner.candidate.id });
    expect(lock.status).toBe(201);

    const covered = await open(who, FRI_EVENING);
    expect(covered.status).toBe("locked");
    expect(covered.lead).toBe("moment");
    expect(covered.nudge).not.toBeNull();

    // Same for a weekend moment: a locked weekend plan covering it keeps the moment leading.
    const weekend = await account(app, "nudge-lockedweekend@example.com");
    await addRange(weekend);
    await lockPlan(weekend, { scale: "weekend", startDate: "2026-10-10", endDate: "2026-10-11" });
    const body = await open(weekend, WED);
    expect(body.moment.kind).toBe("weekend");
    expect(body.status).toBe("locked");
    expect(body.lead).toBe("moment");
    expect(body.nudge).not.toBeNull();
  });

  it("acceptance 11: Not now hides it for 7 days (clock-advanced), and Show again brings it back", async () => {
    const who = await account(app, "nudge-snooze@example.com");
    const range = await addRange(who);
    const visible = await open(who, WED);
    expect(visible.nudge).not.toBeNull();
    if (visible.jobId) await waitForJob(who.agent, visible.jobId);

    const snoozed = await who.agent.post(`/api/time-off/${range.id}/snooze`).set(HDR, "1").send({ localDate: "2026-10-07" });
    expect(snoozed.body.timeOff.snoozedUntil).toBe("2026-10-14");

    expect((await open(who, WED)).nudge).toBeNull();
    expect((await open(who, "2026-10-13T14:00")).nudge).toBeNull();
    expect((await open(who, "2026-10-14T14:00")).nudge).toBeNull();
    const after = await open(who, "2026-10-15T14:00");
    expect(after.nudge).not.toBeNull();

    await who.agent.post(`/api/time-off/${range.id}/snooze`).set(HDR, "1").send({ localDate: "2026-10-15" });
    expect((await open(who, "2026-10-16T14:00")).nudge).toBeNull();
    await who.agent.post(`/api/time-off/${range.id}/unsnooze`).set(HDR, "1");
    expect((await open(who, "2026-10-16T14:00")).nudge).not.toBeNull();
  });

  it("ranges that are over or more than 183 days away do not nudge; the earliest eligible one wins", async () => {
    const who = await account(app, "nudge-select@example.com");
    await addRange(who, { label: "Past", startDate: "2026-09-01", endDate: "2026-09-05" });
    await addRange(who, { label: "Far", startDate: "2027-06-01", endDate: "2027-06-10" });
    expect((await open(who, WED)).nudge).toBeNull();
    await addRange(who, { label: "Later", startDate: "2026-12-20", endDate: "2026-12-22" });
    await addRange(who, { label: "Sooner", startDate: "2026-11-01", endDate: "2026-11-03" });
    const body = await open(who, WED);
    expect(body.nudge.timeOff.label).toBe("Sooner");
    if (body.jobId) await waitForJob(who.agent, body.jobId);
  });

  it("acceptance 11: five opens create no plan rows of their own and at most one idea generation", async () => {
    const who = await account(app, "nudge-opens@example.com");
    const range = await addRange(who);
    const before = getIdeaGenerationCount();

    const first = await open(who, WED);
    expect(first.jobId).toBeTruthy();
    await waitForJob(who.agent, first.jobId);
    const rowsAfterFirst = await planRows(who);

    const ideas: unknown[] = [first.nudge.ideas];
    for (let i = 0; i < 4; i += 1) {
      const body = await open(who, WED);
      ideas.push(body.nudge.ideas);
    }
    expect(getIdeaGenerationCount() - before).toBeLessThanOrEqual(1);
    expect(await planRows(who)).toBe(rowsAfterFirst);
    expect(new Set(ideas.map((i) => JSON.stringify(i))).size).toBe(1);

    const db = await getDb();
    const cached = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM trip_ideas WHERE life_date_id = $1", [range.id]);
    expect(cached.rows[0].n).toBe(1);
    // Trip ideas are text only: no trip spec or plan exists.
    const trips = await db.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM plan_specs WHERE user_id = $1 AND scale IN ('getaway', 'vacation')",
      [who.userId]
    );
    expect(trips.rows[0].n).toBe(0);
    const jobs = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM plan_generation_jobs WHERE user_id = $1", [who.userId]);
    expect(jobs.rows[0].n).toBe(1);
  });

  it("refreshes the cached ideas after the taste set changes", async () => {
    const who = await account(app, "nudge-fingerprint@example.com");
    await addRange(who);
    const first = await open(who, WED);
    if (first.jobId) await waitForJob(who.agent, first.jobId);
    const before = getIdeaGenerationCount();
    await open(who, WED);
    expect(getIdeaGenerationCount()).toBe(before);
    await who.agent.post("/api/tastes").set(HDR, "1").send({ text: "loves live music", polarity: "love" });
    await open(who, WED);
    expect(getIdeaGenerationCount()).toBe(before + 1);
  });

  it("tapping an idea is the normal plan-specs flow with the destination hint", async () => {
    const who = await account(app, "nudge-tap@example.com");
    await addRange(who);
    const body = await open(who, WED);
    if (body.jobId) await waitForJob(who.agent, body.jobId);
    const idea = body.nudge.ideas[0] as { name: string; scope: string };
    const generated = await postAndAwaitGeneration(who.agent, "/api/plan-specs", {
      scale: idea.scope,
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
      participantIds: [who.ownerId],
      moodContext: `Trip idea: ${idea.name}`,
    });
    expect(generated.job.status).toBe("succeeded");
    expect((generated.body.spec as { moodContext: string; scale: string }).moodContext).toBe(`Trip idea: ${idea.name}`);
    expect((generated.body.spec as { scale: string }).scale).toBe("getaway");
    expect(generated.body.winner).toBeTruthy();
  });

  it("acceptance 11: with zero ranges nothing mentions vacation or time off", async () => {
    const who = await account(app, "nudge-none@example.com");
    for (const time of [WED, FRI_EVENING, "2026-10-10T11:00"]) {
      const body = await open(who, time);
      expect(body.nudge).toBeNull();
      expect(body.lead).toBe("moment");
      const visible = JSON.stringify({ moment: body.moment, reasonLine: body.reasonLine, reasonParts: body.reasonParts, nudge: body.nudge });
      expect(visible).not.toMatch(/vacation|time off|holiday|trip idea/i);
      if (body.jobId) await waitForJob(who.agent, body.jobId);
    }
  });
});

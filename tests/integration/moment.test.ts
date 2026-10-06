import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { getDb } from "../../src/server/db/client.js";
import { stringifyJsonForDb } from "../../src/server/db/json.js";
import { HDR, postAndAwaitGeneration, waitForJob } from "../helpers/planJobs.js";

// 2026-10-09 is a Friday, 2026-10-10 a Saturday, 2026-10-11 a Sunday, 2026-10-07 a Wednesday.
const FRI_AFTERNOON = "2026-10-09T14:00";
const FRI_AFTERNOON_LATER = "2026-10-09T14:10";
const WED = "2026-10-07T14:00";

let ipCounter = 10;

async function account(app: unknown, email: string) {
  // Every account gets its own client address so the per-IP rate limiters never couple tests together.
  const ip = `10.7.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
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
async function open(who: Account, localDateTime: string, kind?: string): Promise<any> {
  const res = await who.agent
    .post("/api/moment")
    .set(HDR, "1")
    .send({ localDateTime, ...(kind ? { kind } : {}) });
  expect(res.status).toBe(200);
  return res.body;
}

/** Opens; if a job was started, waits for it and opens again (what the Home screen does). */
async function openReady(who: Account, localDateTime: string, kind?: string): Promise<any> {
  const first = await open(who, localDateTime, kind);
  if (first.status !== "generating") return first;
  const job = await waitForJob(who.agent, first.jobId);
  expect(job.status).toBe("succeeded");
  return open(who, localDateTime, kind);
}

async function planRowCount(userId: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM plans WHERE user_id = $1", [userId]);
  return rows[0].n;
}

async function specGenerationCount(specId: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ n: number }>("SELECT generation_count AS n FROM plan_specs WHERE id = $1", [specId]);
  return rows[0].n;
}

async function addPerson(who: Account, name: string, kind: "person" | "pet", relationship: string | null) {
  const res = await who.agent.post("/api/participants").set(HDR, "1").send({ name, kind, relationship });
  expect(res.status).toBe(201);
  return res.body.participant as { id: string };
}

const MEAL_PLACE = { address: null, sourceUrl: "https://www.openstreetmap.org/node/1", sourceLabel: "OpenStreetMap", factualNote: "Mapped as a restaurant." };
function shapedBeats(order: "meal-second" | "meal-last", firstStart: string) {
  const walk = {
    title: "Start gently at Jardim Azul", description: "Take an easy loop.", category: "walk", indoor: false,
    startTime: firstStart, durationMinutes: 150, travelMode: "walking", distanceFromPreviousKm: 0.4, travelMinutes: 5,
    place: { ...MEAL_PLACE, name: "Jardim Azul", kind: "garden", sourceUrl: "https://www.openstreetmap.org/node/2" },
  };
  const meal = {
    title: "Meal at Mare Alta", description: "Dinner.", category: "food", indoor: true,
    startTime: "19:00", durationMinutes: 90, travelMode: "walking", distanceFromPreviousKm: 0.6, travelMinutes: 8,
    place: { ...MEAL_PLACE, name: "Mare Alta", kind: "restaurant" },
  };
  const stroll = {
    title: "Soft finish at Miradouro Claro", description: "Stroll.", category: "stroll", indoor: false,
    startTime: "20:40", durationMinutes: 25, travelMode: "walking", distanceFromPreviousKm: 0.5, travelMinutes: 6,
    place: { ...MEAL_PLACE, name: "Miradouro Claro", kind: "viewpoint", sourceUrl: "https://www.openstreetmap.org/node/3" },
  };
  return order === "meal-second" ? [walk, meal, stroll] : [walk, stroll, { ...meal, startTime: "12:30" }];
}

async function reshapePlan(planId: string, candidateId: string, beats: unknown[]) {
  const db = await getDb();
  await db.query("UPDATE candidates SET payload = jsonb_set(payload, '{beats}', $2::jsonb) WHERE id = $1", [candidateId, stringifyJsonForDb(beats)]);
  await db.query("UPDATE plans SET beats = $2::jsonb WHERE id = $1", [planId, stringifyJsonForDb(beats)]);
}

async function suggestedHistory(who: Account) {
  const res = await who.agent.get("/api/history");
  return res.body.suggested as { id: string; candidateId: string; beats: { place?: { name: string } | null }[] }[];
}

describe("POST /api/moment (demo AI)", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  it("validates strictly and requires a session", async () => {
    const anon = request.agent(app as never);
    anon.set("X-Forwarded-For", "10.9.9.9");
    expect((await anon.post("/api/moment").set(HDR, "1").send({ localDateTime: FRI_AFTERNOON })).status).toBe(401);

    const who = await account(app, "moment-validate@example.com");
    for (const body of [
      {},
      { localDateTime: "garbage" },
      { localDateTime: "2026-10-09" },
      { localDateTime: "2026-10-09T25:00" },
      { localDateTime: "2026-10-09T14:00Z" },
      { localDateTime: "2019-10-09T14:00" },
      { localDateTime: "2101-10-09T14:00" },
      { localDateTime: FRI_AFTERNOON, kind: "brunch" },
      { localDateTime: FRI_AFTERNOON, extra: true },
    ]) {
      const res = await who.agent.post("/api/moment").set(HDR, "1").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await planRowCount(who.userId)).toBe(0);
  });

  it("reports an empty household without creating anything", async () => {
    const who = await account(app, "moment-empty@example.com");
    const db = await getDb();
    await db.query("DELETE FROM participants WHERE user_id = $1", [who.userId]);
    const body = await open(who, FRI_AFTERNOON);
    expect(body.status).toBe("empty_household");
    expect(body.plan).toBeNull();
    expect(body.jobId).toBeNull();
    expect(await planRowCount(who.userId)).toBe(0);
  });

  it("acceptance 3: reuses by key + fingerprint, regenerates on a fingerprint change, shows another, and opening never spends the ceiling", async () => {
    const who = await account(app, "moment-reuse@example.com");
    const first = await open(who, FRI_AFTERNOON);
    expect(first.status).toBe("generating");
    expect(first.moment.key).toBe("tonight:2026-10-09");
    expect(first.moment.label).toBe("Friday evening");
    expect(first.nudge).toBeNull();
    expect(first.lead).toBe("moment");
    await waitForJob(who.agent, first.jobId);

    const a = await open(who, FRI_AFTERNOON);
    expect(a.status).toBe("ready");
    expect(a.jobId).toBeNull();
    const planA = a.plan.winner.candidate.id as string;
    const specA = a.plan.spec.id as string;
    expect(a.plan.spec.momentKey).toBe("tonight:2026-10-09");
    expect(a.plan.spec.scale).toBe("day_off");
    expect(a.plan.spec.radiusKm).toBe(25);
    expect(a.plan.spec.participantIds).toEqual([who.ownerId]);
    expect(a.plan.generationsUsed).toBe(1);
    expect(a.reasonLine).toContain("Friday evening");
    expect(await planRowCount(who.userId)).toBe(1);

    // Repeated opens: same plan id, one History row, the ceiling untouched.
    for (let i = 0; i < 5; i += 1) {
      const again = await open(who, FRI_AFTERNOON_LATER);
      expect(again.status).toBe("ready");
      expect(again.plan.winner.candidate.id).toBe(planA);
    }
    expect(await planRowCount(who.userId)).toBe(1);
    expect((await suggestedHistory(who)).filter((p) => p.candidateId === planA)).toHaveLength(1);
    expect(await specGenerationCount(specA)).toBe(1);

    // Show another (the existing route) creates a second plan under the same key; opening returns it.
    const another = await postAndAwaitGeneration(who.agent, `/api/plan-specs/${specA}/regenerate`);
    expect(another.job.status).toBe("succeeded");
    const planB = (another.body.winner as { candidate: { id: string } }).candidate.id;
    expect(planB).not.toBe(planA);
    const afterShow = await open(who, FRI_AFTERNOON_LATER);
    expect(afterShow.plan.winner.candidate.id).toBe(planB);
    expect(afterShow.plan.spec.id).toBe(specA);
    expect(await planRowCount(who.userId)).toBe(2);
    expect(await specGenerationCount(specA)).toBe(2);

    // A new key creates a new row and a new setup.
    const weekend = await openReady(who, WED);
    expect(weekend.moment).toMatchObject({ kind: "weekend", planDate: "2026-10-10", key: "weekend:2026-10-10" });
    expect(weekend.plan.spec.scale).toBe("weekend");
    expect(weekend.plan.spec.radiusKm).toBe(60);
    expect(weekend.plan.spec.id).not.toBe(specA);
    expect(await planRowCount(who.userId)).toBe(3);

    // A new constraint changes the fingerprint: the next open is a new proposal that obeys it.
    const constraint = await who.agent.post("/api/constraints").set(HDR, "1").send({ text: "peanut allergy" });
    expect(constraint.status).toBe(201);
    const fresh = await openReady(who, FRI_AFTERNOON_LATER);
    expect(fresh.plan.spec.id).not.toBe(specA);
    expect(fresh.plan.spec.inputsFingerprint).not.toBe(a.plan.spec.inputsFingerprint);
    expect(/peanut/i.test(`${fresh.plan.winner.candidate.title} ${fresh.plan.winner.candidate.rationale}`)).toBe(false);
    expect(await planRowCount(who.userId)).toBe(4);
    // ... and it is the stable answer from then on.
    const stable = await open(who, FRI_AFTERNOON_LATER);
    expect(stable.plan.winner.candidate.id).toBe(fresh.plan.winner.candidate.id);
    expect(await planRowCount(who.userId)).toBe(4);
  });

  it("acceptance 3: a new relationship is a fingerprint change", async () => {
    const who = await account(app, "moment-relationship@example.com");
    const dani = await addPerson(who, "Dani", "person", null);
    const before = await openReady(who, FRI_AFTERNOON);
    const patch = await who.agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: "friend" });
    expect(patch.status).toBe(200);
    const after = await openReady(who, FRI_AFTERNOON);
    expect(after.plan.spec.id).not.toBe(before.plan.spec.id);
    expect(after.plan.spec.inputsFingerprint).not.toBe(before.plan.spec.inputsFingerprint);
    // A rename is not a fingerprint change.
    await who.agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ name: "Daniela" });
    const renamed = await open(who, FRI_AFTERNOON);
    expect(renamed.status).toBe("ready");
    expect(renamed.plan.spec.id).toBe(after.plan.spec.id);
  });

  it("acceptance 4: a stale tonight plan is retimed in place, same venues, one reversible revision, no new History row", async () => {
    const who = await account(app, "moment-retime@example.com");
    const made = await openReady(who, FRI_AFTERNOON);
    const planId = (await suggestedHistory(who))[0].id;
    const originalCandidate = made.plan.winner.candidate.id as string;
    const originalSpec = made.plan.spec.id as string;
    await reshapePlan(planId, originalCandidate, shapedBeats("meal-second", "16:30"));

    const rows = await planRowCount(who.userId);
    const retimed = await open(who, "2026-10-09T20:30");
    expect(retimed.status).toBe("ready");
    expect(retimed.jobId).toBeNull();
    const beats = retimed.plan.winner.candidate.beats as { startTime: string; place: { name: string } }[];
    expect(beats.map((b) => b.place.name).sort()).toEqual(["Jardim Azul", "Mare Alta", "Miradouro Claro"]);
    expect(beats[0].place.name).toBe("Mare Alta");
    expect(beats[0].startTime).toBe("21:00");
    expect(retimed.plan.spec.parentSpecId).toBe(originalSpec);
    expect(retimed.plan.spec.version).toBe(2);
    expect(retimed.plan.spec.generationCount).toBe(1);
    expect(retimed.plan.winner.candidate.id).not.toBe(originalCandidate);

    // No new History row: the same plan row now points at the retimed candidate.
    expect(await planRowCount(who.userId)).toBe(rows);
    const history = await suggestedHistory(who);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(planId);
    expect(history[0].candidateId).toBe(retimed.plan.winner.candidate.id);
    // Reversible: the original revision is still stored under the parent spec.
    const parent = await who.agent.get(`/api/plan-specs/${originalSpec}`);
    expect(parent.body.candidates.map((c: { id: string }) => c.id)).toContain(originalCandidate);
    expect(await specGenerationCount(originalSpec)).toBe(1);

    // Opening again a minute later is stable (the first beat has not started yet).
    const again = await open(who, "2026-10-09T20:31");
    expect(again.plan.winner.candidate.id).toBe(retimed.plan.winner.candidate.id);
  });

  it("acceptance 4: an earlier-evening retime keeps the order and moves the meal into its window", async () => {
    const who = await account(app, "moment-retime-early@example.com");
    const made = await openReady(who, FRI_AFTERNOON);
    const planId = (await suggestedHistory(who))[0].id;
    await reshapePlan(planId, made.plan.winner.candidate.id, shapedBeats("meal-second", "16:30"));
    const retimed = await open(who, "2026-10-09T18:01");
    const beats = retimed.plan.winner.candidate.beats as { startTime: string; place: { name: string } }[];
    expect(beats.map((b) => b.place.name)).toEqual(["Jardim Azul", "Mare Alta", "Miradouro Claro"]);
    expect(beats[0].startTime).toBe("18:45");
    expect(beats[1].startTime >= "19:00" && beats[1].startTime <= "21:00").toBe(true);
  });

  it("acceptance 4: a day plan whose lunch window cannot be met is replaced by a new proposal", async () => {
    const who = await account(app, "moment-day-replace@example.com");
    const made = await openReady(who, "2026-10-10T06:30");
    expect(made.moment.key).toBe("day:2026-10-10");
    const planId = (await suggestedHistory(who))[0].id;
    await reshapePlan(planId, made.plan.winner.candidate.id, shapedBeats("meal-last", "10:00"));

    const rows = await planRowCount(who.userId);
    const stale = await open(who, "2026-10-10T10:30");
    expect(stale.status).toBe("generating");
    await waitForJob(who.agent, stale.jobId);
    const replaced = await open(who, "2026-10-10T10:30");
    expect(replaced.status).toBe("ready");
    expect(replaced.plan.winner.candidate.id).not.toBe(made.plan.winner.candidate.id);
    expect(replaced.plan.spec.id).toBe(made.plan.spec.id);
    expect(replaced.plan.generationsUsed).toBe(2);
    expect(await planRowCount(who.userId)).toBe(rows + 1);
  });

  it("acceptance 5: a locked plan that covers the moment is returned and nothing is created", async () => {
    const who = await account(app, "moment-locked@example.com");
    const made = await openReady(who, FRI_AFTERNOON);
    const lock = await who.agent
      .post(`/api/plan-specs/${made.plan.spec.id}/lock`)
      .set(HDR, "1")
      .send({ candidateId: made.plan.winner.candidate.id });
    expect(lock.status).toBe(201);
    const rows = await planRowCount(who.userId);

    const covered = await open(who, FRI_AFTERNOON_LATER);
    expect(covered.status).toBe("locked");
    expect(covered.lockedPlanId).toBe(lock.body.plan.id);
    expect(covered.plan.winner.candidate.id).toBe(made.plan.winner.candidate.id);
    expect(covered.jobId).toBeNull();
    expect(await planRowCount(who.userId)).toBe(rows);

    // Once its last beat has ended today it no longer covers a tonight moment.
    await reshapePlan(lock.body.plan.id, made.plan.winner.candidate.id, [
      { ...shapedBeats("meal-second", "12:00")[0], durationMinutes: 30 },
    ]);
    const ended = await open(who, "2026-10-09T17:00");
    expect(ended.status).toBe("generating");
    expect(ended.lockedPlanId).toBeNull();
    await waitForJob(who.agent, ended.jobId);
  });

  it("zero-click: fresh=true builds a new proposal even when a plan is reused or locked", async () => {
    const who = await account(app, "moment-fresh@example.com");
    const made = await openReady(who, FRI_AFTERNOON);
    const lock = await who.agent.post(`/api/plan-specs/${made.plan.spec.id}/lock`).set(HDR, "1").send({ candidateId: made.plan.winner.candidate.id });
    expect(lock.status).toBe(201);
    expect((await open(who, FRI_AFTERNOON)).status).toBe("locked");
    const res = await who.agent.post("/api/moment").set(HDR, "1").send({ localDateTime: FRI_AFTERNOON, fresh: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("generating");
    const job = await waitForJob(who.agent, res.body.jobId);
    expect(job.status).toBe("succeeded");
    expect(job.result.spec.id).not.toBe(made.plan.spec.id);
  });

  it("acceptance 5: a locked Saturday plan covers a Friday 22:00 day moment dated Saturday", async () => {
    const who = await account(app, "moment-locked-sat@example.com");
    const generated = await postAndAwaitGeneration(who.agent, "/api/plan-specs", {
      scale: "day_off", startDate: "2026-10-10", endDate: "2026-10-10", participantIds: [who.ownerId],
    });
    const winner = generated.body.winner as { candidate: { id: string } };
    const spec = generated.body.spec as { id: string };
    const lock = await who.agent.post(`/api/plan-specs/${spec.id}/lock`).set(HDR, "1").send({ candidateId: winner.candidate.id });
    expect(lock.status).toBe(201);
    const rows = await planRowCount(who.userId);

    const covered = await open(who, "2026-10-09T22:00");
    expect(covered.moment).toMatchObject({ kind: "day", planDate: "2026-10-10" });
    expect(covered.status).toBe("locked");
    expect(covered.lockedPlanId).toBe(lock.body.plan.id);
    expect(await planRowCount(who.userId)).toBe(rows);
    // A locked plan of another day does not cover this one.
    const otherDay = await open(who, "2026-10-09T14:00");
    expect(otherDay.status).toBe("generating");
    await waitForJob(who.agent, otherDay.jobId);
  });

  it("acceptance 5: a locked Saturday-Sunday weekend plan covers a Sunday moment by date overlap", async () => {
    const who = await account(app, "moment-locked-weekend@example.com");
    const generated = await postAndAwaitGeneration(who.agent, "/api/plan-specs", {
      scale: "weekend", startDate: "2026-10-10", endDate: "2026-10-11", participantIds: [who.ownerId],
    });
    const winner = generated.body.winner as { candidate: { id: string } };
    const spec = generated.body.spec as { id: string };
    await who.agent.post(`/api/plan-specs/${spec.id}/lock`).set(HDR, "1").send({ candidateId: winner.candidate.id });
    const covered = await open(who, "2026-10-11T10:00");
    expect(covered.moment).toMatchObject({ kind: "day", planDate: "2026-10-11" });
    expect(covered.status).toBe("locked");
  });

  it("acceptance 6: a stored allergy is never violated, by a new proposal or a reused one", async () => {
    const who = await account(app, "moment-allergy@example.com");
    await who.agent.post("/api/constraints").set(HDR, "1").send({ text: "peanut allergy" });
    const violates = (body: any) =>
      /peanut/i.test(JSON.stringify([body.plan.winner.candidate.title, body.plan.winner.candidate.rationale, body.plan.winner.candidate.beats]));
    for (const when of [FRI_AFTERNOON, "2026-10-10T06:30", WED, "2026-10-10T14:00"]) {
      const body = await openReady(who, when);
      expect(body.status).toBe("ready");
      expect(violates(body)).toBe(false);
      const reused = await open(who, when);
      expect(reused.status).toBe("ready");
      expect(violates(reused)).toBe(false);
    }

    // The filter is applied again to a reused plan: a tampered stored plan is not served.
    const first = await open(who, FRI_AFTERNOON);
    const db = await getDb();
    await db.query("UPDATE candidates SET payload = jsonb_set(payload, '{title}', '\"Peanut satay supper\"'::jsonb) WHERE id = $1", [
      first.plan.winner.candidate.id,
    ]);
    const guarded = await open(who, FRI_AFTERNOON);
    expect(guarded.status).toBe("generating");
    expect(guarded.plan).toBeNull();
    await waitForJob(who.agent, guarded.jobId);
  });

  it("acceptance 7: the reason line carries only parts that exist in the user's data", async () => {
    const who = await account(app, "moment-reason@example.com");
    const dani = await addPerson(who, "Dani", "person", "sister");
    const pom = await addPerson(who, "Pom", "pet", "dog");

    // No tastes: no taste clause. No forecast (always so in tests): no weather clause.
    const bare = await openReady(who, FRI_AFTERNOON);
    expect(bare.reasonParts.taste).toBeNull();
    expect(bare.reasonParts.weather).toBeNull();
    expect(bare.reasonParts.moment).toBe("Friday evening");
    expect(bare.reasonParts.people).toEqual(["you", "your sister", "Pom"]);
    expect(bare.reasonParts.peopleIds).toEqual([who.ownerId, dani.id, pom.id]);
    expect(bare.reasonLine).toBe("Friday evening for you, your sister and Pom");
    expect(bare.reasonLine).not.toMatch(/romantic|vacation|time off/i);

    // A taste that the plan really reflects is quoted exactly as stored, with an id that exists.
    const taste = await who.agent.post("/api/tastes").set(HDR, "1").send({ text: "a long stroll", polarity: "love" });
    expect(taste.status).toBe(201);
    await who.agent.post("/api/constraints").set(HDR, "1").send({ text: "no spicy food" }); // new fingerprint -> new proposal
    const withTaste = await openReady(who, FRI_AFTERNOON);
    expect(withTaste.reasonParts.taste).toEqual({ id: taste.body.taste.id, text: "a long stroll" });
    expect(withTaste.reasonLine).toContain("“a long stroll”");
    const stored = await open(who, FRI_AFTERNOON);
    expect(stored.reasonLine).toBe(withTaste.reasonLine);

    // A taste the plan does not reflect is not cited.
    const db = await getDb();
    await db.query("UPDATE tastes SET text = 'xylophone orchestras' WHERE id = $1", [taste.body.taste.id]);
    const shown = await who.agent.post("/api/moment").set(HDR, "1").send({ localDateTime: FRI_AFTERNOON });
    // reuse keeps the line that was stored with the plan
    expect(shown.body.reasonParts.taste.id).toBe(taste.body.taste.id);
    const fresh = await who.agent.post(`/api/plan-specs/${withTaste.plan.spec.id}/regenerate`).set(HDR, "1").send({});
    await waitForJob(who.agent, fresh.body.jobId);
    const regenerated = await open(who, FRI_AFTERNOON);
    expect(regenerated.reasonParts.taste).toBeNull();
    expect(regenerated.reasonLine).not.toContain("xylophone");
  });

  it("acceptance 7: a friend account's taste is never quoted, and share snapshots hold no reason parts", async () => {
    const alice = await account(app, "moment-friend-alice@example.com");
    const bob = await account(app, "moment-friend-bob@example.com");
    const invite = await alice.agent.post("/api/friends/invites").set(HDR, "1");
    await bob.agent.post(`/api/friends/invites/${invite.body.invite.token}/accept`).set(HDR, "1");
    await bob.agent.post("/api/tastes").set(HDR, "1").send({ text: "zanzibar stroll spice", polarity: "love" });
    await alice.agent.post("/api/tastes").set(HDR, "1").send({ text: "sunset stroll", polarity: "love" });

    const body = await openReady(alice, FRI_AFTERNOON);
    const bobOwner = (await bob.agent.get("/api/participants")).body.participants[0].id as string;
    expect(body.plan.spec.participantIds).toEqual([alice.ownerId]);
    expect(body.plan.spec.participantIds).not.toContain(bobOwner);
    expect(JSON.stringify(body)).not.toMatch(/zanzibar/i);
    expect(body.reasonParts.taste?.text ?? "sunset stroll").toBe("sunset stroll");

    const share = await alice.agent.post("/api/shares").set(HDR, "1").send({ candidateId: body.plan.winner.candidate.id });
    expect(share.status).toBe(201);
    const snapshot = await request(app as never).get(`/api/shares/${share.body.share.token}`);
    expect(snapshot.status).toBe(200);
    const text = JSON.stringify(snapshot.body);
    expect(text).not.toMatch(/reasonParts|reasonLine|inputsFingerprint|momentKey|peopleIds/);
    expect(text).not.toContain(body.reasonLine);
  });

  it("acceptance 8: romantic framing only for owner + one local partner-word person (pets ignored) on a tonight moment", async () => {
    // Owner + wife + a dog, Friday evening -> framing.
    const couple = await account(app, "moment-romantic@example.com");
    const wife = await addPerson(couple, "Dani", "person", "wife");
    await addPerson(couple, "Pom", "pet", "dog");
    const romantic = await openReady(couple, FRI_AFTERNOON);
    expect(romantic.romantic).toBe(true);
    expect(romantic.reasonParts.romantic).toBe(true);
    expect(romantic.reasonLine).toContain("romantic evening");
    expect(romantic.plan.spec.moodContext).toContain("Romantic evening for two");
    expect(romantic.plan.spec.moodContext.length).toBeLessThanOrEqual(280);
    expect(romantic.reasonParts.people).toEqual(["you", "your wife", "Pom"]);

    // The same group on a day moment is neutral.
    const day = await openReady(couple, "2026-10-10T06:30");
    expect(day.romantic).toBe(false);
    expect(day.reasonLine).not.toMatch(/romantic/i);

    // Relationship unset -> neutral; setting it changes the fingerprint and flips to the framing.
    const unset = await account(app, "moment-romantic-unset@example.com");
    const partner = await addPerson(unset, "Dani", "person", null);
    await addPerson(unset, "Pom", "pet", "dog");
    const neutral = await openReady(unset, FRI_AFTERNOON);
    expect(neutral.romantic).toBe(false);
    expect(neutral.reasonLine).not.toMatch(/romantic/i);
    expect(neutral.plan.spec.moodContext).not.toMatch(/romantic/i);
    await unset.agent.patch(`/api/participants/${partner.id}`).set(HDR, "1").send({ relationship: "wife" });
    const flipped = await openReady(unset, FRI_AFTERNOON);
    expect(flipped.romantic).toBe(true);
    expect(flipped.plan.spec.id).not.toBe(neutral.plan.spec.id);
    // Clearing it again returns to neutral.
    await unset.agent.patch(`/api/participants/${partner.id}`).set(HDR, "1").send({ relationship: null });
    const cleared = await openReady(unset, FRI_AFTERNOON);
    expect(cleared.romantic).toBe(false);

    // Owner + two other people -> neutral.
    const trio = await account(app, "moment-romantic-trio@example.com");
    await addPerson(trio, "Dani", "person", "wife");
    await addPerson(trio, "Rui", "person", "brother");
    const crowd = await openReady(trio, FRI_AFTERNOON);
    expect(crowd.romantic).toBe(false);
    expect(crowd.reasonLine).not.toMatch(/romantic/i);

    // A friend account never triggers it, and the friends list still says "PlanBuddy friend".
    const owner = await account(app, "moment-romantic-friend-owner@example.com");
    const friend = await account(app, "moment-romantic-friend@example.com");
    const invite = await owner.agent.post("/api/friends/invites").set(HDR, "1");
    await friend.agent.post(`/api/friends/invites/${invite.body.invite.token}/accept`).set(HDR, "1");
    const withFriend = await openReady(owner, FRI_AFTERNOON);
    expect(withFriend.romantic).toBe(false);
    expect(withFriend.plan.spec.participantIds).toEqual([owner.ownerId]);
    const friends = await owner.agent.get("/api/friends");
    expect(friends.body.friends[0].participant.relationship).toBe("PlanBuddy friend");
    expect(wife.id).toBeTruthy();
  });

  it("is tenant-scoped: another account never sees or reuses a plan", async () => {
    const alice = await account(app, "moment-tenant-alice@example.com");
    const bob = await account(app, "moment-tenant-bob@example.com");
    const a = await openReady(alice, FRI_AFTERNOON);
    const b = await open(bob, FRI_AFTERNOON);
    expect(b.status).toBe("generating");
    expect(b.plan).toBeNull();
    await waitForJob(bob.agent, b.jobId);
    const bReady = await open(bob, FRI_AFTERNOON);
    expect(bReady.plan.winner.candidate.id).not.toBe(a.plan.winner.candidate.id);
    expect(bReady.plan.spec.userId).toBe(bob.userId);
  });

  it("the scope switch uses the explicit kind with the spec's dates", async () => {
    const who = await account(app, "moment-scope@example.com");
    const tonight = await openReady(who, "2026-10-09T22:00", "tonight");
    expect(tonight.moment).toMatchObject({ kind: "tonight", planDate: "2026-10-10", key: "tonight:2026-10-10" });
    expect(tonight.plan.spec.startDate).toBe("2026-10-10");
    expect(tonight.plan.spec.momentTimes.startTime).toBe("16:30");
    expect(tonight.plan.spec.momentTimes.mealFirst).toBe(false);
  });
});

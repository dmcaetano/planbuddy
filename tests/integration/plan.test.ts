import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";

const HDR = "X-PlanBuddy-Client";

async function signUpWithHomeBase(app: unknown, email: string) {
  const agent = request.agent(app as never);
  await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  await agent
    .put("/api/auth/home-base")
    .set(HDR, "1")
    .send({ label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 });
  const participants = await agent.get("/api/participants");
  return { agent, ownerId: participants.body.participants[0].id as string };
}

describe("plan generation integration (demo AI)", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("generates a plan, applies the deterministic constraint filter, and locks it", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan1@example.com");
    await agent.post("/api/constraints").set(HDR, "1").send({ text: "peanut allergy" });

    const generate = await agent
      .post("/api/plan-specs")
      .set(HDR, "1")
      .send({ scale: "day_off", startDate: "2026-08-01", endDate: "2026-08-01", participantIds: [ownerId] });
    expect(generate.status).toBe(201);
    expect(generate.body.aiMode).toBe("demo");
    expect(generate.body.deadEnd).toBe(false);
    expect(generate.body.winner).toBeTruthy();

    const specId = generate.body.spec.id;
    const full = await agent.get(`/api/plan-specs/${specId}`);

    // Any raw AI candidate that trips the peanut-allergy keyword filter must
    // be marked rejected with a constraint-violation reason — this demo AI
    // batch draws 8 of 12 local templates, so the peanut-trigger template
    // (present in the pool specifically to exercise this path) is not
    // guaranteed to be drawn every run; assert conditionally on its presence.
    const peanutCandidates = full.body.candidates.filter((c: { title: string; rationale: string }) =>
      /peanut/i.test(`${c.title} ${c.rationale}`)
    );
    for (const c of peanutCandidates) {
      expect(c.rejected).toBe(true);
      expect(c.rejectionReason).toContain("constraint violation");
    }

    // Regardless of which candidates were drawn, nothing shown to the user
    // (winner, alternates, or any kept/scored candidate) may violate the
    // active constraint — this is the safety property that always holds.
    const kept = full.body.candidates.filter((c: { rejected: boolean }) => !c.rejected);
    const allShown = [generate.body.winner, ...generate.body.alternates, ...kept.map((c: unknown) => ({ candidate: c }))];
    for (const view of allShown) {
      expect(/peanut/i.test(`${view.candidate.title} ${view.candidate.rationale}`)).toBe(false);
    }

    const lock = await agent
      .post(`/api/plan-specs/${specId}/lock`)
      .set(HDR, "1")
      .send({ candidateId: generate.body.winner.candidate.id });
    expect(lock.status).toBe(201);
    expect(lock.body.plan.status).toBe("locked");

    const history = await agent.get("/api/history");
    expect(history.body.upcoming.some((p: { id: string }) => p.id === lock.body.plan.id)).toBe(true);
  });

  it("returns a destination anchor and exactly 3 beats for a getaway plan", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan2@example.com");
    const generate = await agent
      .post("/api/plan-specs")
      .set(HDR, "1")
      .send({ scale: "getaway", startDate: "2026-09-01", endDate: "2026-09-03", participantIds: [ownerId] });
    expect(generate.status).toBe(201);
    expect(generate.body.winner.candidate.destinationAnchor).toBeTruthy();
    expect(generate.body.winner.candidate.beats).toHaveLength(3);
  });

  it("not-this rejects the candidate, records evidence, and moves browsing forward", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan3@example.com");
    const generate = await agent
      .post("/api/plan-specs")
      .set(HDR, "1")
      .send({ scale: "day_off", startDate: "2026-08-05", endDate: "2026-08-05", participantIds: [ownerId] });
    const specId = generate.body.spec.id;
    const winnerId = generate.body.winner.candidate.id;

    const notThis = await agent
      .post(`/api/plan-specs/${specId}/not-this`)
      .set(HDR, "1")
      .send({ candidateId: winnerId, reason: "Too far from home" });
    expect(notThis.status).toBe(201);

    const hunches = await agent.get("/api/hunches");
    expect(hunches.body.hunches.length).toBeGreaterThan(0);

    const history = await agent.get("/api/history");
    expect(history.body.past.some((p: { candidateId: string; status: string }) => p.candidateId === winnerId && p.status === "rejected")).toBe(true);
  });

  it("caps regeneration at one extra batch, then returns honest looseners", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan4@example.com");
    const generate = await agent
      .post("/api/plan-specs")
      .set(HDR, "1")
      .send({ scale: "day_off", startDate: "2026-08-06", endDate: "2026-08-06", participantIds: [ownerId] });
    const specId = generate.body.spec.id;

    const regen1 = await agent.post(`/api/plan-specs/${specId}/regenerate`).set(HDR, "1");
    expect(regen1.status).toBe(200);
    expect(regen1.body.winner).toBeTruthy();
    expect(regen1.body.generationsUsed).toBe(2);

    const regen2 = await agent.post(`/api/plan-specs/${specId}/regenerate`).set(HDR, "1");
    expect(regen2.status).toBe(200);
    expect(regen2.body.looseners).toBeTruthy();
    expect(regen2.body.winner).toBeNull();
  });

  it("locking creates a feedback-eligible plan and feedback creates a hunch", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan5@example.com");
    const generate = await agent
      .post("/api/plan-specs")
      .set(HDR, "1")
      .send({ scale: "day_off", startDate: "2026-08-07", endDate: "2026-08-07", participantIds: [ownerId] });
    const lock = await agent
      .post(`/api/plan-specs/${generate.body.spec.id}/lock`)
      .set(HDR, "1")
      .send({ candidateId: generate.body.winner.candidate.id });

    const feedback = await agent
      .post(`/api/history/${lock.body.plan.id}/feedback`)
      .set(HDR, "1")
      .send({ rating: 5, comment: "loved it, amazing pick" });
    expect(feedback.status).toBe(201);

    const hunches = await agent.get("/api/hunches");
    expect(hunches.body.hunches.some((h: { polarity: string }) => h.polarity === "love")).toBe(true);
  });
});

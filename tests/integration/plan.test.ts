import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { getDb } from "../../src/server/db/client.js";
import { postAndAwaitGeneration, waitForJob, HDR } from "../helpers/planJobs.js";

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

    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      participantIds: [ownerId],
    });
    expect(generate.kickoffStatus).toBe(202);
    expect(generate.job.status).toBe("succeeded");
    expect(generate.body.aiMode).toBe("demo");
    expect(generate.body.deadEnd).toBe(false);
    expect(generate.body.winner).toBeTruthy();

    const spec = generate.body.spec as { id: string };
    const winner = generate.body.winner as { candidate: { id: string } };
    const specId = spec.id;
    const historyBeforeLock = await agent.get("/api/history");
    const surfaced = historyBeforeLock.body.suggested.find(
      (p: { candidateId: string }) => p.candidateId === winner.candidate.id
    );
    expect(surfaced).toBeTruthy();
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
    const alternates = generate.body.alternates as unknown[];
    const allShown = [generate.body.winner, ...alternates, ...kept.map((c: unknown) => ({ candidate: c }))];
    for (const view of allShown as { candidate: { title: string; rationale: string } }[]) {
      expect(/peanut/i.test(`${view.candidate.title} ${view.candidate.rationale}`)).toBe(false);
    }

    // A client cannot bypass the safety boundary by posting the ID of a
    // rejected candidate directly to the lock endpoint.
    const blockedCandidate = full.body.candidates.find(
      (c: { id: string }) => c.id !== winner.candidate.id
    );
    const db = await getDb();
    await db.query(
      "UPDATE candidates SET rejected = true, rejection_reason = 'constraint violation: test' WHERE id = $1",
      [blockedCandidate.id]
    );
    const unsafeLock = await agent
      .post(`/api/plan-specs/${specId}/lock`)
      .set(HDR, "1")
      .send({ candidateId: blockedCandidate.id });
    expect(unsafeLock.status).toBe(409);

    const lock = await agent
      .post(`/api/plan-specs/${specId}/lock`)
      .set(HDR, "1")
      .send({ candidateId: winner.candidate.id });
    expect(lock.status).toBe(201);
    expect(lock.body.plan.status).toBe("locked");
    expect(lock.body.plan.id).toBe(surfaced.id);

    const history = await agent.get("/api/history");
    expect(history.body.upcoming.some((p: { id: string }) => p.id === lock.body.plan.id)).toBe(true);
    expect(history.body.suggested.some((p: { candidateId: string }) => p.candidateId === winner.candidate.id)).toBe(false);
    const matchingRecords = [...history.body.suggested, ...history.body.upcoming, ...history.body.past]
      .filter((p: { candidateId: string }) => p.candidateId === winner.candidate.id);
    expect(matchingRecords).toHaveLength(1);
  });

  it("returns a destination anchor and exactly 3 beats for a getaway plan", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan2@example.com");
    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "getaway",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      participantIds: [ownerId],
    });
    expect(generate.job.status).toBe("succeeded");
    const winner = generate.body.winner as { candidate: { destinationAnchor: unknown; beats: unknown[] } };
    expect(winner.candidate.destinationAnchor).toBeTruthy();
    expect(winner.candidate.beats).toHaveLength(3);
  });

  it("not-this rejects the candidate, records evidence, and moves browsing forward", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan3@example.com");
    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-05",
      endDate: "2026-08-05",
      participantIds: [ownerId],
    });
    const spec = generate.body.spec as { id: string };
    const winner = generate.body.winner as { candidate: { id: string } };
    const specId = spec.id;
    const winnerId = winner.candidate.id;

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

  it("allows at least three fresh suggestions and caps only after twenty", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan4@example.com");
    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-06",
      endDate: "2026-08-06",
      participantIds: [ownerId],
    });
    const spec = generate.body.spec as { id: string };
    const specId = spec.id;

    const regen1Kickoff = await agent.post(`/api/plan-specs/${specId}/regenerate`).set(HDR, "1");
    expect(regen1Kickoff.status).toBe(202);
    const regen1Job = await waitForJob(agent, regen1Kickoff.body.jobId);
    expect(regen1Job.status).toBe("succeeded");
    const regen1Body = regen1Job.result as Record<string, unknown>;
    expect(regen1Body.winner).toBeTruthy();
    expect(regen1Body.generationsUsed).toBe(2);

    const regen2Kickoff = await agent.post(`/api/plan-specs/${specId}/regenerate`).set(HDR, "1");
    expect(regen2Kickoff.status).toBe(202);
    const regen2Job = await waitForJob(agent, regen2Kickoff.body.jobId);
    expect(regen2Job.status).toBe("succeeded");
    const regen2Body = regen2Job.result as Record<string, unknown>;
    expect(regen2Body.winner).toBeTruthy();
    expect(regen2Body.generationsUsed).toBe(3);

    const db = await getDb();
    await db.query("UPDATE plan_specs SET generation_count = 20 WHERE id = $1", [specId]);
    const cappedKickoff = await agent.post(`/api/plan-specs/${specId}/regenerate`).set(HDR, "1");
    const cappedJob = await waitForJob(agent, cappedKickoff.body.jobId);
    const cappedBody = cappedJob.result as Record<string, unknown>;
    expect(cappedBody.looseners).toBeTruthy();
    expect(cappedBody.winner).toBeNull();
  });

  it("locking creates a feedback-eligible plan and feedback creates a hunch", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "plan5@example.com");
    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-07",
      endDate: "2026-08-07",
      participantIds: [ownerId],
    });
    const spec = generate.body.spec as { id: string };
    const winner = generate.body.winner as { candidate: { id: string } };
    const lock = await agent
      .post(`/api/plan-specs/${spec.id}/lock`)
      .set(HDR, "1")
      .send({ candidateId: winner.candidate.id });

    const feedback = await agent
      .post(`/api/history/${lock.body.plan.id}/feedback`)
      .set(HDR, "1")
      .send({ rating: 5, comment: "loved it, amazing pick" });
    expect(feedback.status).toBe(201);

    const hunches = await agent.get("/api/hunches");
    expect(hunches.body.hunches.some((h: { polarity: string }) => h.polarity === "love")).toBe(true);
  });

  it("learns from thumbs-style rating feedback even without a comment", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "rating-only@example.com");
    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-08",
      endDate: "2026-08-08",
      participantIds: [ownerId],
    });
    const spec = generate.body.spec as { id: string };
    const winner = generate.body.winner as { candidate: { id: string } };
    const lock = await agent
      .post(`/api/plan-specs/${spec.id}/lock`)
      .set(HDR, "1")
      .send({ candidateId: winner.candidate.id });

    const feedback = await agent
      .post(`/api/history/${lock.body.plan.id}/feedback`)
      .set(HDR, "1")
      .send({ rating: 1, comment: null });
    expect(feedback.status).toBe(201);

    const hunches = await agent.get("/api/hunches");
    expect(hunches.body.hunches.some((h: { polarity: string }) => h.polarity === "avoid")).toBe(true);
  });
});

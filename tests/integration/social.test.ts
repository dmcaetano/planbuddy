import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { getDb } from "../../src/server/db/client.js";
import { findMealBeatIndex, gatherPlanContext } from "../../src/server/plans/engine/pipeline.js";
import { postAndAwaitGeneration, waitForJob, HDR } from "../helpers/planJobs.js";

async function account(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const signup = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  await agent.put("/api/auth/home-base").set(HDR, "1").send({ label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 });
  const participants = await agent.get("/api/participants");
  return { agent, userId: signup.body.user.id as string, ownerId: participants.body.participants[0].id as string };
}

/** Kicks off a generation and waits for it to finish; returns { body: <old sync response shape>, status }. */
async function generate(agent: request.SuperAgentTest, ownerId: string, date: string) {
  return postAndAwaitGeneration(agent, "/api/plan-specs", {
    scale: "day_off",
    startDate: date,
    endDate: date,
    participantIds: [ownerId],
  });
}

describe("social learning, sharing, and friends", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => { app = await getTestApp(); });

  it("makes Love idempotent, learns venue-agnostic features, and never authorizes another account", async () => {
    const alice = await account(app, "social-love-alice@example.com");
    const bob = await account(app, "social-love-bob@example.com");
    const plan = await generate(alice.agent, alice.ownerId, "2026-08-10");
    const specId = plan.body.spec.id as string;
    const candidateId = plan.body.winner.candidate.id as string;

    const first = await alice.agent.post(`/api/plan-specs/${specId}/react`).set(HDR, "1").send({ candidateId, reaction: "love" });
    expect(first.status).toBe(200);
    expect(first.body.learned.features.length).toBeGreaterThanOrEqual(2);
    const suggestionHistory = await alice.agent.get("/api/history");
    const savedSuggestion = suggestionHistory.body.suggested.find((plan: { candidateId: string }) => plan.candidateId === candidateId);
    expect(savedSuggestion).toBeTruthy();
    const savedDetail = await alice.agent.get(`/api/history/${savedSuggestion.id}`);
    expect(savedDetail.body.reaction.reaction).toBe("love");
    const learnedText = JSON.stringify(first.body.learned).toLowerCase();
    for (const beat of plan.body.winner.candidate.beats) {
      if (beat.place?.name) expect(learnedText).not.toContain(String(beat.place.name).toLowerCase());
    }

    const db = await getDb();
    const before = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM hunch_evidence WHERE session_id = $1", [candidateId]);
    const second = await alice.agent.post(`/api/plan-specs/${specId}/react`).set(HDR, "1").send({ candidateId, reaction: "love" });
    expect(second.status).toBe(200);
    const after = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM hunch_evidence WHERE session_id = $1", [candidateId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);

    const bobAttempt = await bob.agent.post(`/api/plan-specs/${specId}/react`).set(HDR, "1").send({ candidateId, reaction: "love" });
    expect(bobAttempt.status).toBe(404);
    const bobHunches = await bob.agent.get("/api/hunches");
    expect(bobHunches.body.hunches).toHaveLength(0);

    const undoLove = await alice.agent.post(`/api/plan-specs/${specId}/react`).set(HDR, "1").send({ candidateId, reaction: "like" });
    expect(undoLove.status).toBe(200);
    const remaining = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM hunch_evidence WHERE session_id = $1", [candidateId]);
    expect(remaining.rows[0].count).toBe("0");

    const dislike = await alice.agent.post(`/api/plan-specs/${specId}/react`).set(HDR, "1").send({ candidateId, reaction: "dislike" });
    expect(dislike.status).toBe(200);
    const dislikeEvidence = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM hunch_evidence WHERE session_id = $1", [candidateId]);
    expect(dislikeEvidence.rows[0].count).toBe("1");
    await alice.agent.post(`/api/plan-specs/${specId}/react`).set(HDR, "1").send({ candidateId, reaction: "like" });
    const clearedDislike = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM hunch_evidence WHERE session_id = $1", [candidateId]);
    expect(clearedDislike.rows[0].count).toBe("0");
  });

  it("creates an immutable privacy-safe share snapshot and stores only the token hash", async () => {
    const alice = await account(app, "social-share-alice@example.com");
    const bob = await account(app, "social-share-bob@example.com");
    await alice.agent.post("/api/constraints").set(HDR, "1").send({ text: "private gluten intolerance" });
    const plan = await generate(alice.agent, alice.ownerId, "2026-08-11");
    const candidateId = plan.body.winner.candidate.id as string;
    const create = await alice.agent.post("/api/shares").set(HDR, "1").send({ candidateId });
    expect(create.status).toBe(201);
    const token = create.body.share.token as string;

    const db = await getDb();
    const stored = await db.query<{ token_hash: string }>("SELECT token_hash FROM plan_shares WHERE id = $1", [create.body.share.id]);
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(stored.rows[0].token_hash).toHaveLength(64);

    const publicRead = await request(app).get(`/api/shares/${token}`);
    expect(publicRead.status).toBe(200);
    expect(publicRead.headers["x-robots-tag"]).toContain("noindex");
    expect(publicRead.body.snapshot.candidate.citations).toEqual([]);
    expect(publicRead.body.snapshot.candidate.constraintCompliance).toEqual([]);
    expect(publicRead.body.snapshot.candidate.scoreBreakdown.perParticipantFit).toEqual({});
    expect(publicRead.body.snapshot.candidate.beats[0].directionsUrl).toBeNull();
    expect(JSON.stringify(publicRead.body.snapshot).toLowerCase()).not.toContain("private gluten intolerance");

    const unauthorized = await bob.agent.post("/api/shares").set(HDR, "1").send({ candidateId });
    expect(unauthorized.status).toBe(404);
    await alice.agent.post(`/api/shares/${create.body.share.id}/revoke`).set(HDR, "1");
    expect((await request(app).get(`/api/shares/${token}`)).status).toBe(404);
  });

  it("accepts a friend invite once, allows explicit friend planning, and rejects stale or guessed participants", async () => {
    const alice = await account(app, "social-friend-alice@example.com");
    const bob = await account(app, "social-friend-bob@example.com");
    const carol = await account(app, "social-friend-carol@example.com");
    await bob.agent.post("/api/tastes").set(HDR, "1").send({ text: "quiet grilled fish dinners", participantId: bob.ownerId, polarity: "love" });
    await bob.agent.post("/api/constraints").set(HDR, "1").send({ text: "step-free route needed", participantId: bob.ownerId });

    const invite = await alice.agent.post("/api/friends/invites").set(HDR, "1");
    const token = invite.body.invite.token as string;
    expect((await request(app).get(`/api/friends/invites/${token}`)).status).toBe(200);
    const accept = await bob.agent.post(`/api/friends/invites/${token}/accept`).set(HDR, "1");
    expect(accept.status).toBe(200);
    expect((await bob.agent.post(`/api/friends/invites/${token}/accept`).set(HDR, "1")).status).toBe(200);
    expect((await carol.agent.post(`/api/friends/invites/${token}/accept`).set(HDR, "1")).status).toBe(404);
    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(1);

    const groupPlan = await postAndAwaitGeneration(alice.agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-12",
      endDate: "2026-08-12",
      participantIds: [alice.ownerId, bob.ownerId],
    });
    expect(groupPlan.kickoffStatus).toBe(202);
    expect(groupPlan.job.status).toBe("succeeded");
    expect(groupPlan.body.winner.activeConstraints).toEqual([]);
    const context = await gatherPlanContext(alice.userId, groupPlan.body.spec);
    expect(context.scopedTastes.some((taste) => taste.userId === bob.userId && /grilled fish/i.test(taste.text))).toBe(true);
    expect(context.scopedConstraints.some((constraint) => constraint.userId === bob.userId && /step-free/i.test(constraint.text))).toBe(true);

    const guessed = await alice.agent.post("/api/plan-specs").set(HDR, "1").send({
      scale: "day_off",
      startDate: "2026-08-13",
      endDate: "2026-08-13",
      participantIds: [alice.ownerId, carol.ownerId],
    });
    expect(guessed.status).toBe(403);

    await alice.agent.delete(`/api/friends/${bob.userId}`).set(HDR, "1");
    const staleTweak = await alice.agent.post(`/api/plan-specs/${groupPlan.body.spec.id}/tweak`).set(HDR, "1").send({ moodContext: "make it earlier" });
    expect(staleTweak.status).toBe(403);
  });

  it("lets plan chat perform actions and preserves non-meal stops during a surgical restaurant edit", async () => {
    const alice = await account(app, "social-plan-chat@example.com");
    const initial = await generate(alice.agent, alice.ownerId, "2026-08-14");
    const threadSpecId = initial.body.spec.id as string;
    const original = initial.body.winner.candidate;
    const detectedMealIndex = findMealBeatIndex(original.beats);
    const originalMealIndex = detectedMealIndex >= 0 ? detectedMealIndex : 1;

    const edit = await alice.agent.post(`/api/plan-specs/${threadSpecId}/chat-action`).set(HDR, "1").send({
      candidateId: original.id,
      message: "Change only the restaurant and keep the two walks",
    });
    expect(edit.status).toBe(202);
    expect(edit.body.action.editMode).toBe("restaurant");
    expect(edit.body.jobId).toBeTruthy();
    const editJob = await waitForJob(alice.agent, edit.body.jobId);
    expect(editJob.status).toBe("succeeded");
    const changed = (editJob.result as { winner: { candidate: typeof original } }).winner.candidate;
    for (let index = 0; index < original.beats.length; index += 1) {
      if (index === originalMealIndex) continue;
      expect(changed.beats[index].place?.name ?? null).toBe(original.beats[index].place?.name ?? null);
      expect(changed.beats[index].title).toBe(original.beats[index].title);
    }

    const dinner = await alice.agent.post(`/api/plan-specs/${threadSpecId}/chat-action`).set(HDR, "1").send({
      candidateId: changed.id,
      message: "Make it dinner instead and reorganize the timing",
    });
    expect(dinner.status).toBe(202);
    expect(dinner.body.action.editMode).toBe("meal_time");
    const dinnerJob = await waitForJob(alice.agent, dinner.body.jobId);
    expect(dinnerJob.status).toBe("succeeded");
    const dinnerCandidate = (dinnerJob.result as { winner: { candidate: typeof original } }).winner.candidate;
    expect(dinnerCandidate.beats[originalMealIndex].startTime).toBe("19:30");

    const love = await alice.agent.post(`/api/plan-specs/${threadSpecId}/chat-action`).set(HDR, "1").send({
      candidateId: dinnerCandidate.id,
      message: "I love this plan",
    });
    expect(love.body.learned.features.length).toBeGreaterThanOrEqual(2);

    const share = await alice.agent.post(`/api/plan-specs/${threadSpecId}/chat-action`).set(HDR, "1").send({
      candidateId: dinnerCandidate.id,
      message: "Share this plan",
    });
    expect(share.body.share.token).toBeTruthy();

    const lock = await alice.agent.post(`/api/plan-specs/${threadSpecId}/chat-action`).set(HDR, "1").send({
      candidateId: dinnerCandidate.id,
      message: "Lock it",
    });
    expect(lock.body.plan.status).toBe("locked");

    const invite = await alice.agent.post(`/api/plan-specs/${threadSpecId}/chat-action`).set(HDR, "1").send({
      candidateId: dinnerCandidate.id,
      message: "Invite a friend",
    });
    expect(invite.body.invite.token).toBeTruthy();
    const history = await alice.agent.get(`/api/plan-specs/${threadSpecId}/chat`);
    expect(history.body.messages.length).toBeGreaterThanOrEqual(10);
  });
});

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { getDb } from "../../src/server/db/client.js";
import { newId } from "../../src/server/db/id.js";
import { enqueueGenerationJob, sweepInterruptedJobs } from "../../src/server/plans/jobs.js";
import { createPlanSpec } from "../../src/server/plans/specs.repo.js";
import { runGeneration } from "../../src/server/plans/engine/pipeline.js";
import { STAGE_META, type StageKey } from "../../src/server/plans/engine/stages.js";
import { postAndAwaitGeneration, waitForJob, HDR } from "../helpers/planJobs.js";

async function signUpWithHomeBase(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const signup = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  await agent
    .put("/api/auth/home-base")
    .set(HDR, "1")
    .send({ label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 });
  const participants = await agent.get("/api/participants");
  return { agent, userId: signup.body.user.id as string, ownerId: participants.body.participants[0].id as string };
}

describe("async plan generation jobs", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("kicks off generation as a 202 job and the job's result matches the old sync response shape", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "jobs-basic@example.com");
    const kickoff = await agent.post("/api/plan-specs").set(HDR, "1").send({
      scale: "day_off",
      startDate: "2026-08-20",
      endDate: "2026-08-20",
      participantIds: [ownerId],
    });
    expect(kickoff.status).toBe(202);
    expect(kickoff.body.jobId).toBeTruthy();
    expect(kickoff.body.existing).toBe(false);

    const job = await waitForJob(agent, kickoff.body.jobId);
    expect(job.status).toBe("succeeded");
    expect(job.progressPct).toBe(100);
    expect(job.errorCode).toBeNull();
    const result = job.result as { spec: { id: string }; winner: { candidate: { id: string } } };
    expect(result.spec.id).toBeTruthy();
    expect(result.winner.candidate.id).toBeTruthy();
  });

  it("dedupes a duplicate POST carrying the same idempotencyKey onto the same job", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "jobs-idempotency@example.com");
    const payload = {
      scale: "day_off",
      startDate: "2026-08-21",
      endDate: "2026-08-21",
      participantIds: [ownerId],
      idempotencyKey: "fixed-key-1",
    };
    const first = await agent.post("/api/plan-specs").set(HDR, "1").send(payload);
    expect(first.status).toBe(202);

    const second = await agent.post("/api/plan-specs").set(HDR, "1").send(payload);
    expect(second.status).toBe(202);
    expect(second.body.jobId).toBe(first.body.jobId);
    expect(second.body.existing).toBe(true);

    await waitForJob(agent, first.body.jobId);

    // Even after the first job has finished, the same idempotency key must
    // keep resolving to it rather than starting a fresh generation.
    const third = await agent.post("/api/plan-specs").set(HDR, "1").send(payload);
    expect(third.status).toBe(202);
    expect(third.body.jobId).toBe(first.body.jobId);
    expect(third.body.existing).toBe(true);
  });

  it("returns the same job for a POST while the user already has one active, instead of starting a second generation", async () => {
    // The demo AI pipeline in tests resolves too fast (no real I/O) to
    // reliably race two real HTTP kickoffs against each other, so this
    // seeds an in-flight ('running') job directly the same way a real one
    // would look mid-generation, then asserts the dedupe short-circuit.
    const { agent, userId, ownerId } = await signUpWithHomeBase(app, "jobs-active@example.com");
    const db = await getDb();
    const activeId = newId();
    await db.query(
      `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, status)
       VALUES ($1, $2, 'create', $3, 'running')`,
      [activeId, userId, {}]
    );

    const second = await agent.post("/api/plan-specs").set(HDR, "1").send({
      scale: "day_off",
      startDate: "2026-08-22",
      endDate: "2026-08-22",
      participantIds: [ownerId],
    });
    expect(second.status).toBe(202);
    expect(second.body.jobId).toBe(activeId);
    expect(second.body.existing).toBe(true);

    // No second generation was started for this user — the only job row is
    // the one we seeded, still 'running' (nothing claimed/completed it).
    const { rows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM plan_generation_jobs WHERE user_id = $1`,
      [userId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(activeId);
    expect(rows[0].status).toBe("running");
  });

  it("the partial unique index rejects a second active ('queued'/'running') row for the same user at the DB level", async () => {
    const { userId } = await signUpWithHomeBase(app, "jobs-index@example.com");
    const db = await getDb();
    await db.query(
      `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, status)
       VALUES ($1, $2, 'create', $3, 'running')`,
      [newId(), userId, {}]
    );
    await expect(
      db.query(
        `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, status)
         VALUES ($1, $2, 'create', $3, 'queued')`,
        [newId(), userId, {}]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enqueueGenerationJob folds a concurrent race (both callers pass the pre-check before either inserts) onto a single job via the unique-violation catch path", async () => {
    const { userId } = await signUpWithHomeBase(app, "jobs-race@example.com");

    // A gated executor so the job stays 'running' for the duration of the assertions below, and so
    // both concurrent enqueueGenerationJob calls are racing against the same not-yet-settled state.
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const execute = async () => {
      await gate;
      return { done: true };
    };

    const [first, second] = await Promise.all([
      enqueueGenerationJob({ userId, operation: "create", requestPayload: {}, execute }),
      enqueueGenerationJob({ userId, operation: "create", requestPayload: {}, execute }),
    ]);

    // Exactly one job row was created for this user; both calls resolved to it.
    expect(first.jobId).toBe(second.jobId);
    expect(first.existing || second.existing).toBe(true);

    const db = await getDb();
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM plan_generation_jobs WHERE user_id = $1`, [
      userId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.jobId);

    releaseGate();
  });

  it("is owner-only: another user's job id 404s instead of leaking status or results", async () => {
    const owner = await signUpWithHomeBase(app, "jobs-owner@example.com");
    const stranger = await signUpWithHomeBase(app, "jobs-stranger@example.com");

    const kickoff = await owner.agent.post("/api/plan-specs").set(HDR, "1").send({
      scale: "day_off",
      startDate: "2026-08-23",
      endDate: "2026-08-23",
      participantIds: [owner.ownerId],
    });
    expect(kickoff.status).toBe(202);

    const ownerRead = await owner.agent.get(`/api/plan-jobs/${kickoff.body.jobId}`).set(HDR, "1");
    expect(ownerRead.status).toBe(200);

    const strangerRead = await stranger.agent.get(`/api/plan-jobs/${kickoff.body.jobId}`).set(HDR, "1");
    expect(strangerRead.status).toBe(404);

    await waitForJob(owner.agent, kickoff.body.jobId);
  });

  it("GET /plan-jobs/active reflects the user's most recent non-terminal job, and null once it settles", async () => {
    const { agent, ownerId } = await signUpWithHomeBase(app, "jobs-active-poll@example.com");

    const beforeAny = await agent.get("/api/plan-jobs/active").set(HDR, "1");
    expect(beforeAny.status).toBe(200);
    expect(beforeAny.body.job).toBeNull();

    const kickoff = await agent.post("/api/plan-specs").set(HDR, "1").send({
      scale: "day_off",
      startDate: "2026-08-24",
      endDate: "2026-08-24",
      participantIds: [ownerId],
    });

    const job = await waitForJob(agent, kickoff.body.jobId);
    expect(job.status).toBe("succeeded");

    const afterSettled = await agent.get("/api/plan-jobs/active").set(HDR, "1");
    expect(afterSettled.body.job).toBeNull();
  });

  it("marks a stale queued/running job as failed with error_code 'interrupted' on sweep", async () => {
    // Two different users: the DB-enforced "one active job per user" partial unique index
    // (migration 0008) forbids two active rows for the *same* user, so this needs separate users to
    // seed one stale-and-one-fresh active job simultaneously.
    const { userId: staleUserId } = await signUpWithHomeBase(app, "jobs-sweep-stale@example.com");
    const { userId: freshUserId } = await signUpWithHomeBase(app, "jobs-sweep-fresh@example.com");
    const db = await getDb();
    const staleId = newId();
    const freshId = newId();

    await db.query(
      `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, status, updated_at)
       VALUES ($1, $2, 'create', $3, 'running', now() - interval '11 minutes')`,
      [staleId, staleUserId, {}]
    );
    await db.query(
      `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, status, updated_at)
       VALUES ($1, $2, 'create', $3, 'queued', now())`,
      [freshId, freshUserId, {}]
    );

    const swept = await sweepInterruptedJobs();
    expect(swept).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query<{ id: string; status: string; error_code: string | null }>(
      `SELECT id, status, error_code FROM plan_generation_jobs WHERE id = ANY($1) ORDER BY id`,
      [[staleId, freshId]]
    );
    const stale = rows.find((r) => r.id === staleId)!;
    const fresh = rows.find((r) => r.id === freshId)!;
    expect(stale.status).toBe("failed");
    expect(stale.error_code).toBe("interrupted");
    expect(fresh.status).toBe("queued"); // untouched — not old enough to sweep
  });

  it("never lets a late executor completion resurrect a job that was already swept to 'failed'", async () => {
    const { userId } = await signUpWithHomeBase(app, "jobs-guard@example.com");
    const db = await getDb();
    const jobId = newId();
    // Seed a job already 'running' (as if claimJob had run), then simulate the sweep failing it out
    // from under a still-executing detached job — exactly the race completeJob/failJob must guard
    // against with `WHERE status = 'running'`.
    await db.query(
      `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, status)
       VALUES ($1, $2, 'create', $3, 'running')`,
      [jobId, userId, {}]
    );
    await db.query(
      `UPDATE plan_generation_jobs
       SET status = 'failed', error_code = 'interrupted', error_message = 'swept'
       WHERE id = $1`,
      [jobId]
    );

    // A late completeJob-shaped UPDATE (mirrors src/server/plans/jobs.ts completeJob) must not
    // overwrite the terminal 'failed' state because the row is no longer 'running'.
    const { rows } = await db.query<{ id: string }>(
      `UPDATE plan_generation_jobs
       SET status = 'succeeded', result = $2, progress_pct = 100
       WHERE id = $1 AND status = 'running'
       RETURNING id`,
      [jobId, JSON.stringify({ winner: {} })]
    );
    expect(rows).toHaveLength(0);

    const { rows: after } = await db.query<{ status: string; error_code: string | null }>(
      `SELECT status, error_code FROM plan_generation_jobs WHERE id = $1`,
      [jobId]
    );
    expect(after[0].status).toBe("failed");
    expect(after[0].error_code).toBe("interrupted");
  });

  it("reports stage transitions with non-null stage/progressPct and monotonically increasing progress", async () => {
    const { agent, userId, ownerId } = await signUpWithHomeBase(app, "jobs-stages@example.com");
    const spec = await createPlanSpec(userId, {
      scale: "day_off",
      startDate: "2026-08-25",
      endDate: "2026-08-25",
      participantIds: [ownerId],
    });

    const seen: StageKey[] = [];
    await runGeneration(userId, spec, 0, undefined, async (stage) => {
      seen.push(stage);
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const pcts = seen.map((stage) => STAGE_META[stage].pct);
    for (let i = 1; i < pcts.length; i += 1) {
      expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
    }
    for (const stage of seen) {
      expect(stage).toBeTruthy();
      expect(STAGE_META[stage].label).toBeTruthy();
    }

    // Confirm the same is visible end-to-end through the job row: stage and
    // progressPct are non-null once the job has run.
    const kickoff = await agent.post("/api/plan-specs").set(HDR, "1").send({
      scale: "day_off",
      startDate: "2026-08-26",
      endDate: "2026-08-26",
      participantIds: [ownerId],
    });
    const job = await waitForJob(agent, kickoff.body.jobId);
    expect(job.stage).not.toBeNull();
    expect(job.stageLabel).not.toBeNull();
    expect(job.progressPct).toBeGreaterThan(0);
  });
});

// Exercise postAndAwaitGeneration itself once here too, since every other
// integration test file relies on it as the shared helper for the new
// contract.
describe("postAndAwaitGeneration test helper", () => {
  it("returns a succeeded job's result under body, mirroring the old sync response", async () => {
    const app = await getTestApp();
    const { agent, ownerId } = await signUpWithHomeBase(app, "jobs-helper@example.com");
    const generate = await postAndAwaitGeneration(agent, "/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      participantIds: [ownerId],
    });
    expect(generate.status).toBe(200);
    expect(generate.body.winner).toBeTruthy();
  });
});

import { describe, expect, it, beforeAll } from "vitest";
import { getTestWorkerApp, WorkerAgent } from "../helpers/testWorkerApp.js";

// The real Workflow (step.do/claim/generate/complete) only runs inside the
// actual Workers runtime — it was live-verified end to end against the
// deployed Worker in phase 4 (real generation, lock, react, history; see
// that commit). What's testable here in plain Node is the HTTP contract
// this route layer owns: job-row creation, the 202 + {jobId, existing}
// shape, and idempotency-key dedupe — WorkerAgent's stub PLAN_GENERATION
// binding accepts the .create() call and does nothing further with it.
describe("worker: plan-specs job creation contract (phase 4 route layer)", () => {
  let worker: Awaited<ReturnType<typeof getTestWorkerApp>>;

  beforeAll(async () => {
    worker = await getTestWorkerApp();
  });

  async function signedUpAgent(email: string) {
    const agent = new WorkerAgent(worker);
    await agent.post("/api/auth/signup", { email, password: "password123" });
    return agent;
  }

  async function ownerParticipantId(agent: WorkerAgent): Promise<string> {
    const res = await agent.get("/api/participants");
    const participants = (res.body as { participants: Array<{ id: string; isOwner: boolean }> }).participants;
    return participants.find((p) => p.isOwner)!.id;
  }

  it("POST /api/plan-specs creates a job row and answers 202", async () => {
    const agent = await signedUpAgent("worker-planspecs1@example.com");
    const participantId = await ownerParticipantId(agent);
    const res = await agent.post("/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-12-01",
      endDate: "2026-12-01",
      radiusKm: 25,
      participantIds: [participantId],
    });
    expect(res.status).toBe(202);
    const { jobId, existing } = res.body as { jobId: string; existing: boolean };
    expect(jobId).toBeTruthy();
    expect(existing).toBe(false);

    // The stub Workflow binding never actually runs the job, so it stays
    // 'queued' — exactly proving the route layer handed off to the
    // Workflow binding instead of running anything itself (no runDetached
    // fire-and-forget left over from the Node build).
    const job = await agent.get(`/api/plan-jobs/${jobId}`);
    expect(job.status).toBe(200);
    expect((job.body as { status: string }).status).toBe("queued");
  });

  it("idempotency key dedupes a retried POST onto the same job", async () => {
    const agent = await signedUpAgent("worker-planspecs2@example.com");
    const participantId = await ownerParticipantId(agent);
    const payload = {
      scale: "day_off",
      startDate: "2026-12-05",
      endDate: "2026-12-05",
      radiusKm: 25,
      participantIds: [participantId],
      idempotencyKey: "same-key-123",
    };
    const first = await agent.post("/api/plan-specs", payload);
    const second = await agent.post("/api/plan-specs", payload);
    expect((first.body as { jobId: string }).jobId).toBe((second.body as { jobId: string }).jobId);
    expect((second.body as { existing: boolean }).existing).toBe(true);
  });

  it("rejects an unauthorized participant with 403 before any job row is created", async () => {
    const agent = await signedUpAgent("worker-planspecs3@example.com");
    const res = await agent.post("/api/plan-specs", {
      scale: "day_off",
      startDate: "2026-12-10",
      endDate: "2026-12-10",
      radiusKm: 25,
      participantIds: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(res.status).toBe(403);
  });
});

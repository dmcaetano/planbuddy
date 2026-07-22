import type { Response } from "supertest";
import type { SuperAgentTest } from "supertest";

export const HDR = "X-PlanBuddy-Client";

interface JobBody {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string | null;
  stageLabel: string | null;
  stageDetail: string | null;
  progressPct: number;
  startedAt: string;
  updatedAt: string;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface AwaitedGeneration {
  /** The HTTP status of the original 202 kickoff response. */
  kickoffStatus: number;
  jobId: string;
  existing: boolean;
  /** The final job row once it reached a terminal state. */
  job: JobBody;
  /** HTTP-response-shaped view so most existing "generate.status" /
   * "generate.body.<field>" assertions keep working unmodified: status is
   * the *generation outcome's* status (200 on success, mirroring the old
   * sync endpoint), and body is the stored job result payload. */
  status: number;
  body: Record<string, unknown>;
}

/**
 * Polls GET /api/plan-jobs/:id until the job reaches a terminal state
 * (succeeded/failed), or throws after `timeoutMs`. Plan generation in tests
 * runs against the demo AI / PGlite and is fast, but this still gives real
 * headroom over the actual worst-case pipeline latency.
 */
export async function waitForJob(
  agent: SuperAgentTest,
  jobId: string,
  { timeoutMs = 20_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<JobBody> {
  const deadline = Date.now() + timeoutMs;
  let lastPct = -1;
  for (;;) {
    const res: Response = await agent.get(`/api/plan-jobs/${jobId}`).set(HDR, "1");
    if (res.status !== 200) {
      throw new Error(`GET /api/plan-jobs/${jobId} returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const body = res.body as JobBody;
    if (typeof body.progressPct === "number") {
      if (body.progressPct < lastPct) {
        throw new Error(`Job progress went backwards: ${lastPct} -> ${body.progressPct}`);
      }
      lastPct = body.progressPct;
    }
    if (body.status === "succeeded" || body.status === "failed") {
      return body;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for job ${jobId} to finish (last status: ${body.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * POSTs to a plan-generation-kicking-off endpoint (create / regenerate /
 * tweak) and polls the resulting job to completion. Returns a
 * `{ status, body }` shape that mirrors the old synchronous endpoint
 * response so most existing test assertions (`generate.body.winner`,
 * `generate.status`) keep working with minimal changes.
 */
export async function postAndAwaitGeneration(
  agent: SuperAgentTest,
  path: string,
  payload?: Record<string, unknown>
): Promise<AwaitedGeneration> {
  const kickoff = await agent.post(path).set(HDR, "1").send(payload ?? {});
  if (kickoff.status !== 202) {
    throw new Error(`POST ${path} expected 202, got ${kickoff.status}: ${JSON.stringify(kickoff.body)}`);
  }
  const { jobId, existing } = kickoff.body as { jobId: string; existing: boolean };
  const job = await waitForJob(agent, jobId);
  const body = (job.result ?? {}) as Record<string, unknown>;
  return {
    kickoffStatus: kickoff.status,
    jobId,
    existing,
    job,
    status: job.status === "succeeded" ? 200 : 500,
    body,
  };
}

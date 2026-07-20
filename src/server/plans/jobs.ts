import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { stringifyJsonForDb } from "../db/json.js";
import { logger } from "../logger.js";
import { HttpError } from "../http.js";
import { AiUnavailableError } from "../ai/deepseek.js";
import { STAGE_META, type StageKey } from "./engine/stages.js";

export type JobOperation = "create" | "regenerate" | "tweak";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

interface JobRow {
  id: string;
  user_id: string;
  operation: JobOperation;
  request_payload: unknown;
  status: JobStatus;
  stage: StageKey | null;
  progress_pct: number;
  idempotency_key: string | null;
  attempt: number;
  result: unknown;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobView {
  jobId: string;
  status: JobStatus;
  stage: StageKey | null;
  stageLabel: string | null;
  progressPct: number;
  startedAt: string;
  updatedAt: string;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}

function toView(row: JobRow): JobView {
  return {
    jobId: row.id,
    status: row.status,
    stage: row.stage,
    stageLabel: row.stage ? STAGE_META[row.stage].label : null,
    progressPct: row.progress_pct,
    // There is no separate queueing delay in this design (the job is
    // enqueued and detached in the same tick), so "started" is "created".
    startedAt: row.created_at,
    updatedAt: row.updated_at,
    result: row.result ?? null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

async function findActiveJobForUser(userId: string): Promise<JobRow | null> {
  const db = await getDb();
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM plan_generation_jobs
     WHERE user_id = $1 AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

async function findJobByIdempotencyKey(userId: string, idempotencyKey: string): Promise<JobRow | null> {
  const db = await getDb();
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM plan_generation_jobs WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [userId, idempotencyKey]
  );
  return rows[0] ?? null;
}

export async function getJobForUser(userId: string, id: string): Promise<JobView | null> {
  const db = await getDb();
  const { rows } = await db.query<JobRow>(`SELECT * FROM plan_generation_jobs WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0] ? toView(rows[0]) : null;
}

export async function getActiveJobForUser(userId: string): Promise<JobView | null> {
  const row = await findActiveJobForUser(userId);
  return row ? toView(row) : null;
}

async function createJobRow(input: {
  userId: string;
  operation: JobOperation;
  requestPayload: unknown;
  idempotencyKey: string | null;
}): Promise<JobRow> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<JobRow>(
    `INSERT INTO plan_generation_jobs (id, user_id, operation, request_payload, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, input.userId, input.operation, stringifyJsonForDb(input.requestPayload), input.idempotencyKey]
  );
  return rows[0];
}

async function claimJob(id: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `UPDATE plan_generation_jobs SET status = 'running', updated_at = now()
     WHERE id = $1 AND status = 'queued' RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

async function persistStage(id: string, stage: StageKey): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE plan_generation_jobs SET stage = $2, progress_pct = $3, updated_at = now() WHERE id = $1`,
    [id, stage, STAGE_META[stage].pct]
  );
}

async function completeJob(id: string, result: unknown): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE plan_generation_jobs
     SET status = 'succeeded', result = $2, progress_pct = 100, updated_at = now()
     WHERE id = $1`,
    [id, stringifyJsonForDb(result)]
  );
}

async function failJob(id: string, errorCode: string, errorMessage: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE plan_generation_jobs
     SET status = 'failed', error_code = $2, error_message = $3, updated_at = now()
     WHERE id = $1`,
    [id, errorCode, errorMessage]
  );
}

/**
 * Turns any error thrown out of a job executor into a safe (code, message)
 * pair — never leaking stack traces, provider payloads, or API keys back to
 * the client via the job row.
 */
function sanitizeError(err: unknown): { code: string; message: string } {
  if (err instanceof AiUnavailableError) {
    return { code: "provider_error", message: "Grounded planning is temporarily unavailable. Please try again." };
  }
  if (err instanceof HttpError) {
    const code = err.status === 409 ? "validation_failed" : err.status === 403 ? "forbidden" : "generation_failed";
    // HttpError messages in this codebase are already hand-written,
    // user-safe strings (never raw driver/provider errors), so it's safe to
    // surface them as-is.
    return { code, message: err.message };
  }
  logger.error("Plan generation job failed", {
    error: err instanceof Error ? err.stack ?? err.message : String(err),
  });
  return {
    code: "provider_error",
    message: "Something went wrong while building your plan. Please try again.",
  };
}

async function runDetached(jobId: string, execute: (report: (stage: StageKey) => Promise<void>) => Promise<unknown>) {
  try {
    const claimed = await claimJob(jobId);
    if (!claimed) return; // already claimed/terminal — shouldn't happen, but never double-run

    let lastStage: StageKey | null = null;
    const report = async (stage: StageKey) => {
      if (stage === lastStage) return; // only persist stage TRANSITIONS
      lastStage = stage;
      try {
        await persistStage(jobId, stage);
      } catch (err) {
        logger.warn("Failed to persist plan generation job stage", { jobId, stage, error: String(err) });
      }
    };

    const result = await execute(report);
    await completeJob(jobId, result);
  } catch (err) {
    const { code, message } = sanitizeError(err);
    try {
      await failJob(jobId, code, message);
    } catch (failErr) {
      // The job row itself is unreachable (e.g. DB down) — log loudly, but
      // never let this reject and crash the process; the interrupted-job
      // sweep will eventually recover any job stuck in 'running'.
      logger.error("Failed to mark plan generation job as failed", {
        jobId,
        error: String(failErr),
      });
    }
  }
}

/**
 * Enqueues a generation job for a user and starts it detached (does not
 * await the executor). Handles idempotency-key dedupe and the "already has
 * an active job" short-circuit before creating a new row.
 */
export async function enqueueGenerationJob(params: {
  userId: string;
  operation: JobOperation;
  idempotencyKey?: string | null;
  requestPayload: unknown;
  execute: (report: (stage: StageKey) => Promise<void>) => Promise<unknown>;
}): Promise<{ jobId: string; existing: boolean }> {
  const idempotencyKey = params.idempotencyKey?.trim() || null;

  if (idempotencyKey) {
    const existing = await findJobByIdempotencyKey(params.userId, idempotencyKey);
    if (existing) return { jobId: existing.id, existing: true };
  }

  const active = await findActiveJobForUser(params.userId);
  if (active) return { jobId: active.id, existing: true };

  const job = await createJobRow({
    userId: params.userId,
    operation: params.operation,
    requestPayload: params.requestPayload,
    idempotencyKey,
  });

  // Fire-and-forget: never await this in the request handler. Errors are
  // fully contained inside runDetached (terminalized on the job row), so an
  // unhandled rejection here can never reach the process.
  void runDetached(job.id, params.execute);

  return { jobId: job.id, existing: false };
}

const INTERRUPTED_AFTER_MS = 10 * 60 * 1000;

/**
 * There is no lease/heartbeat loop for the detached executor (a single
 * Node process runs it in-process), so "the process died mid-generation" is
 * detected purely by age: any job still queued/running long past every
 * pipeline stage's plausible duration is presumed orphaned (e.g. the server
 * restarted or crashed mid-run) and is failed out so it never blocks the
 * user's "one active job" slot forever.
 */
export async function sweepInterruptedJobs(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - INTERRUPTED_AFTER_MS).toISOString();
  const { rows } = await db.query<{ id: string }>(
    `UPDATE plan_generation_jobs
     SET status = 'failed',
         error_code = 'interrupted',
         error_message = 'Generation was interrupted — please try again.',
         updated_at = now()
     WHERE status IN ('queued', 'running') AND updated_at < $1
     RETURNING id`,
    [cutoff]
  );
  if (rows.length > 0) {
    logger.warn("Swept interrupted plan generation jobs", { count: rows.length, jobIds: rows.map((r) => r.id) });
  }
  return rows.length;
}

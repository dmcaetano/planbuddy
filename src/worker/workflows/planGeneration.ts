import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { claimJob, persistStage, completeJob, failJob, sanitizeError } from "../../server/plans/jobs.js";
import { getPlanSpec, incrementGenerationCount } from "../../server/plans/specs.repo.js";
import { runGeneration } from "../../server/plans/engine/pipeline.js";
import { pipelineResponse } from "../planSpecs.shared.js";
import { withPooledDb } from "../../server/db/client.js";
import { MAX_GENERATIONS_PER_SPEC } from "../../server/plans/limits.js";
import type { StageKey } from "../../server/plans/engine/stages.js";

export interface PlanGenerationParams {
  jobId: string;
  userId: string;
  specId: string;
  /** generationCount to pass as runGeneration's batchIndex, AND the cap check for "regenerate". */
  attempt: number;
  /** "regenerate" pre-checks the MAX_GENERATIONS_PER_SPEC cap before running; "create"/"tweak" never do (fresh spec, count 0). */
  capCheck: boolean;
}

/**
 * Cloudflare Workflow replacement for jobs.ts's `runDetached` (a bare
 * fire-and-forget async function body, fine in a long-lived Node process
 * but impossible on a Worker: nothing outlives the request past
 * `waitUntil`'s ~30s ceiling, nowhere near AI_AGENT_TIMEOUT_MS=90s or
 * AI_COMPOSE_TIMEOUT_MS=210s). A Workflow instance has no such per-step
 * wall-clock ceiling and survives independently of any HTTP request.
 *
 * Granularity deviation from the ideal ("each model call / tool round /
 * Overpass call is its own step.do()", per the port's plan.md risk #1):
 * `gatherPlanContext` (via `runGeneration`) is wrapped as ONE step.do()
 * rather than decomposed internally — splitting its ~760 lines of
 * memory/weather/grounding/scoring/enrichment logic into separately
 * resumable steps would mean rewriting (and re-verifying) that pipeline,
 * which this port's time budget does not cover safely.
 *
 * Live finding (first real run): this single step hit "Too many
 * subrequests by single Worker invocation" ~55s in, from
 * `wrangler workflows instances describe` — NOT from the AI/Overpass
 * calls, but because db/client.ts's phase-2 fix opened a fresh Neon Pool
 * WebSocket (1 subrequest) per individual query, and this pipeline makes
 * dozens of them. Fixed by wrapping the whole step body in
 * `withPooledDb()` (db/client.ts), which shares ONE Pool connection across
 * every nested getDb() call made during this step instead of one per
 * query — collapsing most of that subrequest cost. If a future generation
 * profile still trips the 50-subrequest or CPU-time ceiling (e.g. a run
 * with many live Overpass + AI tool calls on top of the DB queries), the
 * next move is splitting this single step at its weather/grounding/
 * compose/score boundaries (STAGE_ORDER in stages.ts already names them),
 * not reverting the pooling fix.
 */
export class PlanGenerationWorkflow extends WorkflowEntrypoint<unknown, PlanGenerationParams> {
  async run(event: WorkflowEvent<PlanGenerationParams>, step: WorkflowStep) {
    const { jobId, userId, specId, attempt, capCheck } = event.payload;

    const claimed = await step.do("claim", async () => claimJob(jobId));
    if (!claimed) return; // already claimed/terminal — shouldn't happen, mirrors runDetached's guard

    try {
      const result = await step.do(
        "generate",
        {
          retries: { limit: 0, delay: 0 },
          timeout: "10 minutes",
        },
        async () =>
          // withPooledDb: every getDb() call made anywhere inside this
          // pipeline run (memory/weather/resolver/candidate reads+writes,
          // dozens of queries) shares ONE Neon Pool connection instead of
          // opening a fresh WebSocket per query — live-verified necessary:
          // the per-query-Pool design from phase 2 (correct for a 1-3-query
          // HTTP route) tripped Workers Free's 50-subrequests-per-invocation
          // limit partway through a real generation here.
          withPooledDb(async () => {
            const report = (stage: StageKey, detail?: string) =>
              persistStage(jobId, stage, detail ?? null).catch(() => {
                // Never let a failed narration write fail plan generation (same contract as runDetached's report()).
              });

            const spec = await getPlanSpec(userId, specId);
            if (!spec) {
              throw new Error("Plan spec not found (deleted between enqueue and run?)");
            }

            if (capCheck && spec.generationCount >= MAX_GENERATIONS_PER_SPEC) {
              return {
                spec,
                aiMode: "demo" as const,
                deadEnd: false,
                deadEndReasons: [],
                winner: null,
                alternates: [],
                generationsUsed: spec.generationCount,
                generationsRemaining: 0,
                looseners: [
                  "Widen the search radius",
                  "Temporarily relax a soft taste preference",
                  "Try a different date range",
                ],
              };
            }

            const pipelineResult = await runGeneration(userId, spec, attempt, undefined, report);
            const count = await incrementGenerationCount(spec.id);
            return pipelineResponse({ ...spec, generationCount: count }, pipelineResult, userId);
          })
      );
      await step.do("complete", { retries: { limit: 2, delay: "5 seconds" } }, async () => completeJob(jobId, result));
    } catch (err) {
      const { code, message } = sanitizeError(err);
      await step.do("fail", { retries: { limit: 2, delay: "5 seconds" } }, async () => failJob(jobId, code, message));
    }
  }
}

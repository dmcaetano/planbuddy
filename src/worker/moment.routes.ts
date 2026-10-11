import { Hono } from "hono";
import { momentBodySchema, resolveMomentForUser, type JobDispatch } from "../server/moment/resolve.js";
import { requireAuth } from "./middleware.js";
import { parseBody } from "./http.js";
import { aiRateLimiter } from "./rateLimit.js";
import type { WorkerBindings } from "./bindings.js";

// The one-click home-page proposal (phase 8 addendum, ported alongside
// cutover since the live app's core "opens with a plan already proposed"
// UX depends on it — leaving it 404 and cutting browser traffic over to
// this Worker would break that for every real visit). Reuses
// resolveMomentForUser from the Express build UNCHANGED, via the
// dispatch hook added to moment/routes.ts: when a job needs to start,
// this calls the SAME PlanGenerationWorkflow plan-specs already uses
// (src/worker/workflows/planGeneration.ts), instead of the Node-only
// `enqueueGenerationJob`'s detached in-process executor.
export const momentRouter = new Hono<{ Bindings: WorkerBindings }>();
momentRouter.use("*", requireAuth);

momentRouter.post("/", aiRateLimiter, async (c) => {
  const body = await parseBody(c, momentBodySchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const dispatch: JobDispatch = async (job) => {
    await c.env.PLAN_GENERATION.create({
      id: job.jobId,
      params: { jobId: job.jobId, userId, specId: job.specId, attempt: job.attempt, capCheck: false },
    });
  };
  return c.json(await resolveMomentForUser(userId, body, dispatch));
});

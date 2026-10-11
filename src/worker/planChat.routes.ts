import { Hono } from "hono";
import { planChatActionCreateSchema } from "../shared/schemas.js";
import { getPlanChatThread, postPlanChatAction, type PlanChatJobDispatch } from "../server/plans/plan-chat.service.js";
import { requireAuth } from "./middleware.js";
import { parseBody } from "./http.js";
import { aiRateLimiter } from "./rateLimit.js";
import type { WorkerBindings } from "./bindings.js";

// The "Edit this plan with Buddy" composer, ported after the phase 8
// cutover was already live (a real regression report: browsers now
// redirect here, and this router was the one route module still missing).
// Same split-and-dispatch pattern as moment/chat: plan-chat.service.ts has
// zero express imports, and "show_another"/"edit" start the SAME
// PlanGenerationWorkflow instance plan-specs/moment use, via the
// `edit` field PlanGenerationParams gained for this (planGeneration.ts).
export const planChatRouter = new Hono<{ Bindings: WorkerBindings }>();
planChatRouter.use("*", requireAuth);

planChatRouter.get("/:id/chat", async (c) => {
  const result = await getPlanChatThread(c.get("user")!.id, c.req.param("id"));
  return c.json(result);
});

planChatRouter.post("/:id/chat-action", aiRateLimiter, async (c) => {
  const body = await parseBody(c, planChatActionCreateSchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const dispatch: PlanChatJobDispatch = async (job) => {
    await c.env.PLAN_GENERATION.create({
      id: job.jobId,
      params: {
        jobId: job.jobId,
        userId,
        specId: job.specId,
        attempt: job.attempt,
        capCheck: false,
        edit: job.edit,
        planChatFollowUp: job.planChatFollowUp,
      },
    });
  };
  const result = await postPlanChatAction(userId, c.req.param("id"), body, dispatch);
  return c.json(result, result.jobId ? 202 : 201);
});

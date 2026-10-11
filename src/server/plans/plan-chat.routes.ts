// Thin Express wrapper. All business logic lives in ./plan-chat.service.js
// (split out 2026-10 so the Cloudflare Worker can import the logic
// without pulling in `express` — see that file's header comment for why).
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { asyncHandler, validateBody } from "../http.js";
import { planChatActionCreateSchema } from "../../shared/schemas.js";
import { getPlanChatThread, postPlanChatAction } from "./plan-chat.service.js";

export const planChatRouter = Router();
planChatRouter.use(requireAuth);

planChatRouter.get(
  "/:id/chat",
  asyncHandler(async (req, res) => {
    res.json(await getPlanChatThread(req.user!.id, req.params.id));
  })
);

planChatRouter.post(
  "/:id/chat-action",
  aiRateLimiter,
  validateBody(planChatActionCreateSchema),
  asyncHandler(async (req, res) => {
    const result = await postPlanChatAction(req.user!.id, req.params.id, req.body);
    res.status(result.jobId ? 202 : 201).json(result);
  })
);

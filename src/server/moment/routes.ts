// Thin Express wrapper. All business logic lives in ./resolve.js (split
// out 2026-10 so the Cloudflare Worker can import the logic without
// pulling in `express` — see that file's header comment for why).
import { Router } from "express";
import { asyncHandler, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { momentBodySchema, resolveMomentForUser } from "./resolve.js";

export { momentBodySchema, resolveMomentForUser, type JobDispatch } from "./resolve.js";

export const momentRouter = Router();
momentRouter.use(requireAuth);

momentRouter.post(
  "/",
  aiRateLimiter,
  validateBody(momentBodySchema),
  asyncHandler(async (req, res) => {
    res.json(await resolveMomentForUser(req.user!.id, req.body));
  })
);

import { Router } from "express";
import { asyncHandler, notFound } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { getActiveJobForUser, getJobForUser } from "./jobs.js";

// Deliberately NOT behind aiRateLimiter — this is polled every couple of
// seconds by the client while a generation is in flight and must not be
// throttled alongside the (expensive) generation-triggering endpoints.
export const planJobsRouter = Router();
planJobsRouter.use(requireAuth);

planJobsRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    const job = await getActiveJobForUser(req.user!.id);
    res.json({ job });
  })
);

planJobsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const job = await getJobForUser(req.user!.id, req.params.id);
    if (!job) throw notFound();
    res.json(job);
  })
);

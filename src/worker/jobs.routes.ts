import { Hono } from "hono";
import { getActiveJobForUser, getJobForUser } from "../server/plans/jobs.js";
import { requireAuth } from "./middleware.js";
import { notFoundResponse } from "./http.js";

// Deliberately NOT behind aiRateLimiter — this is polled every couple of
// seconds by the client while a generation is in flight. Job CREATION
// (POST, which kicks off plan generation) is phase 4's Workflow — this
// router is read-only status polling, which is safe to port now.
export const planJobsRouter = new Hono();
planJobsRouter.use("*", requireAuth);

planJobsRouter.get("/active", async (c) => {
  const job = await getActiveJobForUser(c.get("user")!.id);
  return c.json({ job });
});

planJobsRouter.get("/:id", async (c) => {
  const job = await getJobForUser(c.get("user")!.id, c.req.param("id"));
  if (!job) return notFoundResponse(c);
  return c.json(job);
});

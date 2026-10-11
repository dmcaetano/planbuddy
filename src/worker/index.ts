import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachUser, requireSameOrigin } from "./middleware.js";
import { authRouter } from "./auth.routes.js";
import { participantsRouter } from "./participants.routes.js";
import { constraintsRouter } from "./constraints.routes.js";
import { tastesRouter } from "./tastes.routes.js";
import { hunchesRouter } from "./hunches.routes.js";
import { weatherRouter } from "./weather.routes.js";
import { friendsRouter } from "./friends.routes.js";
import { timeOffRouter } from "./timeoff.routes.js";
import { historyRouter } from "./history.routes.js";
import { planJobsRouter } from "./jobs.routes.js";
import { planSpecsRouter } from "./planSpecs.routes.js";
import { isProduction } from "../server/env.js";
import { logger } from "../server/logger.js";
import { HttpError } from "../server/http.js";
import { AiUnavailableError } from "../server/ai/deepseek.js";
import { sweepExpiredChatMessages } from "../server/chat/retention.js";
import { sweepInterruptedJobs } from "../server/plans/jobs.js";
import { buddyRouter } from "./buddy.routes.js";
import { syncToHub } from "../server/omni/hub.js";
import type { WorkerBindings } from "./bindings.js";
export { PlanGenerationWorkflow } from "./workflows/planGeneration.js";

// Cloudflare Worker port (sdlc/005-cloudflare-worker/plan.md). Still 404
// here, by design: /api/moment, /api/chat, /api/plan-specs's chat
// sub-routes, /api/shares — all reach generateCandidates/
// gatherPlanContext, the same multi-step AI+Overpass pipeline phase 4
// wraps in a Workflow, and porting them without that wrapping would
// recreate the exact subrequest/CPU-limit risk the Workflow exists to fix.
const app = new Hono<{ Bindings: WorkerBindings }>();

app.use(
  "*",
  cors({
    origin: isProduction ? () => null : ["http://localhost:5173"],
    credentials: true,
  })
);

app.get("/healthz", (c) => c.json({ ok: true, phase: 6 }));
app.get("/api/health", (c) => c.json({ ok: true }));

// Buddy Contract: HMAC-signed requests carry no browser cookies/headers, so
// this mounts BEFORE the same-origin guard and applies its own guards per
// route (requireSigned / requireConnectSigned / requireSameOrigin+
// attachUser on the session-only /link, /unlink) — same ordering as the
// Express build's app.use("/api/buddy", buddyRouter) before
// app.use(requireSameOrigin).
app.route("/api/buddy", buddyRouter);

app.use("/api/*", requireSameOrigin);
app.use("/api/*", attachUser);

// Phase 6: push to a linked OmniBuddy hub after any successful mutation on
// these routers — ported from the Express build's scheduleSync (debounced
// 3s setTimeout, which cannot survive past this request in a Worker) to an
// immediate `waitUntil(syncToHub(...))`: strictly more eager (one hub push
// per mutation instead of the last one in a 3s burst), never less correct,
// and syncToHub already fails soft and has its own 8s fetch timeout, well
// inside waitUntil's ~30s post-response ceiling.
app.use(/^\/api\/(tastes|constraints|hunches|chat|participants)/, async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.status < 400) {
    const user = c.get("user");
    if (user) c.executionCtx?.waitUntil(syncToHub(user.id));
  }
});

app.route("/api/auth", authRouter);
app.route("/api/participants", participantsRouter);
app.route("/api/constraints", constraintsRouter);
app.route("/api/tastes", tastesRouter);
app.route("/api/hunches", hunchesRouter);
app.route("/api/weather", weatherRouter);
app.route("/api/plan-jobs", planJobsRouter);
app.route("/api/time-off", timeOffRouter);
app.route("/api/history", historyRouter);
app.route("/api/friends", friendsRouter);
app.route("/api/plan-specs", planSpecsRouter);

app.onError((err, c) => {
  if (err instanceof AiUnavailableError) {
    return c.json({ error: "Grounded planning is temporarily unavailable. Please try again." }, 503);
  }
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as never);
  }
  logger.error("Unhandled worker error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  return c.json({ error: "Internal server error" }, 500);
});

// Phase 5: the two setInterval sweeps index.ts (Node/Render) ran at boot
// become Cron Triggers ("*/5 * * * *" and "0 */6 * * *" in wrangler.jsonc).
// Both sweeps are pure DB operations (age-based UPDATE/DELETE), so they are
// identical regardless of which backend executed the original job/session —
// no Workflow-specific "re-create the instance" step is needed: a job stuck
// in queued/running past the cutoff is just marked 'failed' here exactly as
// sweepInterruptedJobs already did for the Node build, whether the stuck
// Workflow instance is still silently running (it will fail its own
// complete/fail step harmlessly once it notices the row is no longer
// 'running' — see completeJob's guard) or already gone.
async function scheduled(event: { cron: string }): Promise<void> {
  if (event.cron === "*/5 * * * *") {
    const count = await sweepInterruptedJobs();
    logger.info("Cron: interrupted-job sweep", { sweptCount: count });
    return;
  }
  if (event.cron === "0 */6 * * *") {
    const count = await sweepExpiredChatMessages();
    logger.info("Cron: chat retention sweep", { deletedCount: count });
    return;
  }
  logger.warn("Cron fired with an unrecognized schedule", { cron: event.cron });
}

export default {
  fetch: app.fetch,
  scheduled,
};

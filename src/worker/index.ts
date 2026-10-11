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
import { isProduction } from "../server/env.js";
import { logger } from "../server/logger.js";

// Cloudflare Worker port (sdlc/005-cloudflare-worker/plan.md). Through
// phase 3: Worker skeleton + assets + Neon driver + auth + every CRUD/read
// route module that does NOT touch the plan-generation engine (which needs
// a Workflow — phase 4) or the Buddy Contract (phase 6, most
// security-sensitive, ported last). Still 404 here, by design, until their
// phase lands: /api/plan-specs, /api/plan-specs (chat), /api/moment,
// /api/chat, /api/shares (all reach generateCandidates/gatherPlanContext,
// the same multi-step AI+Overpass pipeline phase 4 wraps in step.do()
// calls), and /api/buddy (phase 6). The hub-push side effect that the
// Express build ran after tastes/constraints/hunches/chat/participants
// mutations (omni/hub.ts scheduleSync) is ALSO deferred to phase 6: it
// debounces with a bare `setTimeout` 3s after the response, which does not
// survive past a Worker request's lifetime (needs a waitUntil/Queue
// redesign, not a direct port) — so those mutations work normally here,
// just without yet notifying a linked OmniBuddy hub.
const app = new Hono();

app.use(
  "*",
  cors({
    origin: isProduction ? () => null : ["http://localhost:5173"],
    credentials: true,
  })
);

app.get("/healthz", (c) => c.json({ ok: true, phase: 3 }));
app.get("/api/health", (c) => c.json({ ok: true }));

app.use("/api/*", requireSameOrigin);
app.use("/api/*", attachUser);

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

app.onError((err, c) => {
  logger.error("Unhandled worker error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  return c.json({ error: "Internal server error" }, 500);
});

export default app;

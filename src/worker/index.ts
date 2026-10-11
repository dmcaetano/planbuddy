import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachUser, requireSameOrigin } from "./middleware.js";
import { authRouter } from "./auth.routes.js";
import { isProduction } from "../server/env.js";
import { logger } from "../server/logger.js";

// Phase 2 of the Cloudflare Worker port (sdlc/005-cloudflare-worker/plan.md):
// Worker skeleton + static assets ([assets] in wrangler.jsonc) + Neon HTTP
// driver + /healthz + auth routes only. Every other /api/* route module is
// still 404 here and gets ported in phase 3 onward — this file is NOT the
// full app yet.
const app = new Hono();

app.use(
  "*",
  cors({
    origin: isProduction ? () => null : ["http://localhost:5173"],
    credentials: true,
  })
);

app.get("/healthz", (c) => c.json({ ok: true, phase: 2 }));
app.get("/api/health", (c) => c.json({ ok: true }));

app.use("/api/*", requireSameOrigin);
app.use("/api/*", attachUser);

app.route("/api/auth", authRouter);

app.onError((err, c) => {
  logger.error("Unhandled worker error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  return c.json({ error: "Internal server error" }, 500);
});

export default app;

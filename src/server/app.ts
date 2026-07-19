import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, isProduction } from "./env.js";
import { attachUser, requireSameOrigin } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { participantsRouter } from "./participants/routes.js";
import { constraintsRouter } from "./memory/constraints.routes.js";
import { tastesRouter } from "./memory/tastes.routes.js";
import { hunchesRouter } from "./memory/hunches.routes.js";
import { weatherRouter } from "./weather/routes.js";
import { planSpecsRouter } from "./plans/routes.js";
import { historyRouter } from "./plans/history.routes.js";
import { chatRouter } from "./chat/routes.js";
import { HttpError } from "./http.js";
import { logger } from "./logger.js";
import { AiUnavailableError } from "./ai/deepseek.js";
import { friendsRouter } from "./friends/routes.js";
import { sharesRouter } from "./shares/routes.js";
import { planChatRouter } from "./plans/plan-chat.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    cors({
      // Production is a same-origin app; exposing credentialed CORS to
      // arbitrary origins would undermine the mutation-origin guard.
      origin: isProduction ? false : ["http://localhost:5173"],
      credentials: true,
    })
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(requireSameOrigin);
  app.use(attachUser);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/participants", participantsRouter);
  app.use("/api/constraints", constraintsRouter);
  app.use("/api/tastes", tastesRouter);
  app.use("/api/hunches", hunchesRouter);
  app.use("/api/weather", weatherRouter);
  app.use("/api/plan-specs", planSpecsRouter);
  app.use("/api/plan-specs", planChatRouter);
  app.use("/api/history", historyRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/friends", friendsRouter);
  app.use("/api/shares", sharesRouter);

  // __dirname at runtime is dist-server/server; the Vite client build lives at dist/client.
  const clientDist = path.resolve(__dirname, "../../dist/client");
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AiUnavailableError) {
      res.status(503).json({ error: "Grounded planning is temporarily unavailable. Please try again." });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error("Unhandled error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

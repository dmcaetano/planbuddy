import { createApp } from "./app.js";
import { env } from "./env.js";
import { runMigrations } from "./db/migrate.js";
import { sweepExpiredChatMessages } from "./chat/retention.js";
import { sweepInterruptedJobs } from "./plans/jobs.js";
import { logger } from "./logger.js";
import { currentAiMode } from "./ai/index.js";
import { warmPlaceCatalog } from "./resolver/placeResolver.js";

async function main() {
  await runMigrations();

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`PlanBuddy server listening on port ${env.PORT}`, {
      aiMode: currentAiMode(),
      env: env.NODE_ENV,
    });
    if (env.NODE_ENV === "production") {
      void warmPlaceCatalog(38.7223, -9.1393, 60).catch((err) =>
        logger.warn("Lisbon place catalog warm-up failed", { error: String(err) })
      );
    }
  });

  sweepExpiredChatMessages().catch((err) => logger.warn("Initial chat retention sweep failed", { error: String(err) }));
  setInterval(() => {
    sweepExpiredChatMessages().catch((err) => logger.warn("Chat retention sweep failed", { error: String(err) }));
  }, 6 * 60 * 60 * 1000).unref();

  // Recovers any plan generation job left 'queued'/'running' by a crashed
  // or restarted process — there's no lease/heartbeat, so this age-based
  // sweep is what keeps a stuck job from blocking a user's "one active job"
  // slot forever. Runs at boot, then periodically since the process can
  // stay up for a long time between deploys.
  sweepInterruptedJobs().catch((err) => logger.warn("Initial plan generation job sweep failed", { error: String(err) }));
  setInterval(() => {
    sweepInterruptedJobs().catch((err) => logger.warn("Plan generation job sweep failed", { error: String(err) }));
  }, 5 * 60 * 1000).unref();
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});

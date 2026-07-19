import { createApp } from "./app.js";
import { env } from "./env.js";
import { runMigrations } from "./db/migrate.js";
import { sweepExpiredChatMessages } from "./chat/retention.js";
import { logger } from "./logger.js";
import { currentAiMode } from "./ai/index.js";

async function main() {
  await runMigrations();

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`PlanBuddy server listening on port ${env.PORT}`, {
      aiMode: currentAiMode(),
      env: env.NODE_ENV,
    });
  });

  sweepExpiredChatMessages().catch((err) => logger.warn("Initial chat retention sweep failed", { error: String(err) }));
  setInterval(() => {
    sweepExpiredChatMessages().catch((err) => logger.warn("Chat retention sweep failed", { error: String(err) }));
  }, 6 * 60 * 60 * 1000).unref();
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});

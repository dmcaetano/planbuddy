import { createApp } from "../../src/server/app.js";
import { runMigrations } from "../../src/server/db/migrate.js";

let migrated: Promise<void> | null = null;

export async function getTestApp() {
  if (!migrated) {
    migrated = runMigrations();
  }
  await migrated;
  return createApp();
}

export const JSON_HEADER = "X-PlanBuddy-Client";

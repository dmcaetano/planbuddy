import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, __dirnameForMigrations } from "./client.js";
import { logger } from "../logger.js";

export async function runMigrations(): Promise<void> {
  const db = await getDb();
  await db.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );

  const dir = path.join(__dirnameForMigrations, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows } = await db.query<{ name: string }>("SELECT name FROM _migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    logger.info(`Applying migration ${file}`);
    // Statement-by-statement so PGlite (no multi-statement exec) and pg both work.
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.query(statement);
    }
    await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runMigrations()
    .then(() => {
      logger.info("Migrations complete");
      process.exit(0);
    })
    .catch((err) => {
      logger.error("Migration failed", { error: String(err) });
      process.exit(1);
    });
}

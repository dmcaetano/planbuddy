import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { env } from "../env.js";
import { logger } from "../logger.js";

export interface QueryResult<T> {
  rows: T[];
}

export interface DbClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

let dbPromise: Promise<DbClient> | null = null;

function toPgliteParams(params: unknown[] | undefined): unknown[] {
  // PGlite serializes JS objects/arrays passed as params by JSON.stringify-ing
  // them automatically when the column is jsonb; passing plain objects works
  // the same way it does with node-postgres, so no transform is needed today.
  return params ?? [];
}

async function createPool(): Promise<DbClient> {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL?.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    // Keep every unqualified query inside this app's namespace on a shared
    // Neon database. DB_SCHEMA is restricted to [a-z0-9_] in env.ts.
    options: `-c search_path=${env.DB_SCHEMA}`,
  });
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${env.DB_SCHEMA}`);
  return {
    kind: "postgres",
    async query<T>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params as never[]);
      return { rows: result.rows as T[] };
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPglite(): Promise<DbClient> {
  const inMemory = env.PLANBUDDY_DATA_DIR === ":memory:";
  const dataDir = env.PLANBUDDY_DATA_DIR
    ? path.resolve(env.PLANBUDDY_DATA_DIR)
    : path.resolve(process.cwd(), ".data/planbuddy");
  if (!inMemory) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const pglite = inMemory ? new PGlite() : new PGlite(dataDir);
  await pglite.waitReady;
  logger.info(inMemory ? "Using in-memory PGlite database (test mode)" : `Using embedded PGlite database at ${dataDir}`);
  return {
    kind: "pglite",
    async query<T>(text: string, params?: unknown[]) {
      const result = await pglite.query(text, toPgliteParams(params));
      return { rows: result.rows as T[] };
    },
    async close() {
      await pglite.close();
    },
  };
}

export function getDb(): Promise<DbClient> {
  if (!dbPromise) {
    dbPromise = env.DATABASE_URL ? createPool() : createPglite();
  }
  return dbPromise;
}

export async function resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.close();
    dbPromise = null;
  }
}

const __filename = fileURLToPath(import.meta.url);
export const __dirnameForMigrations = path.dirname(__filename);

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "@neondatabase/serverless";
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
let schemaEnsured = false;

function toPgliteParams(params: unknown[] | undefined): unknown[] {
  // PGlite serializes JS objects/arrays passed as params by JSON.stringify-ing
  // them automatically when the column is jsonb; passing plain objects works
  // the same way it does with node-postgres, so no transform is needed today.
  return params ?? [];
}

// Cloudflare Workers has no raw TCP, so the Node `pg` driver (used before
// the Cloudflare Worker port, 2026-10) is replaced by Neon's serverless
// driver. Tried first: the stateless HTTP `neon()` query function — but
// Neon's HTTP data-api proxy does NOT honor a libpq `options=-c
// search_path=...` query-string hint (verified live: current_schema() came
// back "public" even with the param set, while the app's tables live in
// schema "planbuddy"). `Pool` over WebSocket DOES open a real Postgres
// session per connection and DOES honor that same `options` hint (verified
// live: current_schema() -> "planbuddy"), so that's what's used here. It
// also works unchanged from a Worker (WebSocket is a Workers global) and
// from plain Node (Node 18+ has a global WebSocket too).
//
// IMPORTANT (Worker-specific): a Pool's WebSocket is tied to the request
// that created it — Workers forbids touching an I/O object (a live socket)
// from a *different* request's context ("Cannot perform I/O on behalf of a
// different request"), which is exactly what happened when this returned a
// cached singleton Pool reused across requests (live-verified: /api/auth/me
// 500'd with Cloudflare's generic error 1101 the moment it tried to reuse a
// Pool opened during the earlier /login request). So — unlike the old
// long-lived Node `pg.Pool` and unlike the PGlite path below — a fresh Pool
// is opened for every call here. `schemaEnsured` is a plain boolean, not an
// I/O handle, so caching THAT across requests to skip the repeat
// `CREATE SCHEMA IF NOT EXISTS` is safe.
function neonConnectionString(): string {
  const raw = env.DATABASE_URL!;
  // Keep every unqualified query inside this app's namespace on a shared
  // Neon database. DB_SCHEMA is restricted to [a-z0-9_] in env.ts.
  const searchPathOption = encodeURIComponent(`-c search_path=${env.DB_SCHEMA}`);
  return `${raw}${raw.includes("?") ? "&" : "?"}options=${searchPathOption}`;
}

// A plan generation run makes dozens of DB queries (memory, weather cache,
// resolver/place lookups, candidate inserts...) through many independent
// repo files, each calling getDb() on its own. Opening-and-closing one
// WebSocket PER QUERY (the phase-2 fix, correct for a single request that
// makes 1-3 queries) burns one "subrequest" per query — live-verified to
// trip Workers Free's 50-subrequests-per-invocation limit partway through
// one real plan generation ("Error: Too many subrequests by single Worker
// invocation", from `wrangler workflows instances describe`). The fix:
// an AsyncLocalStorage-scoped Pool that every nested getDb() call within
// the SAME call tree reuses — opened once at the top of a bounded unit of
// work (one Workflow step), closed once at the end. This is safe in a way
// module-scope caching was NOT (see createNeonPool's history below): the
// Pool never outlives the single async call tree that created it, so it is
// never touched from a different request/step's I/O context.
const poolContext = new AsyncLocalStorage<Pool>();

/**
 * Runs `fn` with every getDb()-backed query inside it sharing ONE Neon
 * Pool connection (closed when `fn` settles), instead of opening a fresh
 * one per query. Use this to wrap any single bounded unit of work that is
 * known to make many DB calls (a Workflow step.do() body, a batch script) —
 * ordinary one-off HTTP route handlers don't need it, since 1-3 queries per
 * request stays well under the subrequest budget either way.
 */
export async function withPooledDb<T>(fn: () => Promise<T>): Promise<T> {
  if (!env.DATABASE_URL) return fn(); // PGlite path: already a single shared instance, nothing to pool.
  const pool = new Pool({ connectionString: neonConnectionString() });
  try {
    return await poolContext.run(pool, fn);
  } finally {
    await pool.end();
  }
}

async function createNeonPool(): Promise<DbClient> {
  const connectionString = neonConnectionString();
  if (!schemaEnsured) {
    const setupPool = poolContext.getStore() ?? new Pool({ connectionString });
    await setupPool.query(`CREATE SCHEMA IF NOT EXISTS ${env.DB_SCHEMA}`);
    if (!poolContext.getStore()) await setupPool.end();
    schemaEnsured = true;
  }
  return {
    kind: "postgres",
    async query<T>(text: string, params?: unknown[]) {
      const scopedPool = poolContext.getStore();
      if (scopedPool) {
        // Inside withPooledDb: reuse the one Pool for the whole call tree — no new subrequest per query.
        const result = await scopedPool.query(text, (params ?? []) as unknown[]);
        return { rows: result.rows as T[] };
      }
      // Outside withPooledDb: one Pool (one WebSocket) per call, closed
      // before returning — correct and cheap for the common case of 1-3
      // queries in an ordinary HTTP route handler.
      const pool = new Pool({ connectionString });
      try {
        const result = await pool.query(text, (params ?? []) as unknown[]);
        return { rows: result.rows as T[] };
      } finally {
        await pool.end();
      }
    },
    async close() {
      // Nothing persistent to tear down — see above.
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
  // Postgres (Neon Pool): never cached across calls — see createNeonPool's
  // comment above for why a cached Pool breaks on the second request in a
  // Worker. PGlite (embedded, test/dev only): cached, since it is a
  // single in-process database that must not be re-initialised per call.
  if (env.DATABASE_URL) {
    return createNeonPool();
  }
  if (!dbPromise) {
    dbPromise = createPglite();
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

// Lazy: import.meta.url is undefined in the Cloudflare Worker bundle (no
// filesystem there anyway — the Worker never runs migrations, those stay a
// Node-only/Render concern against the same Neon DB), so this must not run
// at module-evaluation time or it throws during the Worker's cold start.
export function dirnameForMigrations(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

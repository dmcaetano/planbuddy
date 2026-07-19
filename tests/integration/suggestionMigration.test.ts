import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

async function applySql(db: PGlite, filename: string) {
  const sql = fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations", filename), "utf8");
  const statements = sql.split(/;\s*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await db.query(statement);
}

describe("suggestion-history migration", () => {
  it("backfills previously surfaced rank-1 candidates without duplicating selected plans", async () => {
    const db = new PGlite();
    await db.waitReady;
    try {
      await applySql(db, "0001_init.sql");
      await db.query("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'history@example.com', 'hash')");
      await db.query(
        `INSERT INTO plan_specs (id, user_id, scale, start_date, end_date, radius_km)
         VALUES ('s1', 'u1', 'day_off', '2026-08-01', '2026-08-01', 25)`
      );
      const payload = {
        title: "Previously shown",
        rationale: "A real earlier winner.",
        category: "food",
        beats: [],
        travelEstimateKm: 4,
      };
      await db.query(
        `INSERT INTO candidates (id, plan_spec_id, payload, rank, rejected)
         VALUES ('c-shown', 's1', $1, 1, false), ('c-hidden', 's1', $2, 2, false)`,
        [payload, { ...payload, title: "Never surfaced" }]
      );

      await applySql(db, "0004_suggestion_history.sql");

      const result = await db.query<{ candidate_id: string; status: string }>(
        "SELECT candidate_id, status FROM plans ORDER BY candidate_id"
      );
      expect(result.rows).toEqual([{ candidate_id: "c-shown", status: "suggested" }]);
    } finally {
      await db.close();
    }
  });
});

import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Feedback } from "../../shared/types.js";

interface FeedbackRow {
  id: string;
  plan_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

function toDomain(row: FeedbackRow): Feedback {
  return { id: row.id, planId: row.plan_id, rating: row.rating, comment: row.comment, createdAt: row.created_at };
}

export async function insertFeedback(planId: string, rating: number, comment: string | null): Promise<Feedback> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<FeedbackRow>(
    `INSERT INTO feedback (id, plan_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, planId, rating, comment]
  );
  return toDomain(rows[0]);
}

export async function listFeedbackForPlan(planId: string): Promise<Feedback[]> {
  const db = await getDb();
  const { rows } = await db.query<FeedbackRow>(
    "SELECT * FROM feedback WHERE plan_id = $1 ORDER BY created_at ASC",
    [planId]
  );
  return rows.map(toDomain);
}

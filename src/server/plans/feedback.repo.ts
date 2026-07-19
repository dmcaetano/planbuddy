import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Feedback, Reaction } from "../../shared/types.js";

interface FeedbackRow {
  id: string;
  plan_id: string;
  rating: number;
  reaction: Reaction;
  comment: string | null;
  feature_summary: string | null;
  features: string[];
  created_at: string;
}

function toDomain(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    planId: row.plan_id,
    rating: row.rating,
    reaction: row.reaction,
    comment: row.comment,
    featureSummary: row.feature_summary,
    features: row.features,
    createdAt: row.created_at,
  };
}

export async function insertFeedback(
  planId: string,
  rating: number,
  reaction: Reaction,
  comment: string | null,
  learned?: { summary: string | null; features: string[] } | null
): Promise<Feedback> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<FeedbackRow>(
    `INSERT INTO feedback (id, plan_id, rating, reaction, comment, feature_summary, features)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, planId, rating, reaction, comment, learned?.summary ?? null, JSON.stringify(learned?.features ?? [])]
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

import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { stringifyJsonForDb } from "../db/json.js";
import type { CandidateReaction, Reaction } from "../../shared/types.js";

interface ReactionRow {
  id: string;
  user_id: string;
  candidate_id: string;
  reaction: Reaction;
  feature_summary: string | null;
  features: string[];
  created_at: string;
  updated_at: string;
}

function toDomain(row: ReactionRow): CandidateReaction {
  return {
    id: row.id,
    userId: row.user_id,
    candidateId: row.candidate_id,
    reaction: row.reaction,
    featureSummary: row.feature_summary,
    features: row.features,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCandidateReaction(userId: string, candidateId: string): Promise<CandidateReaction | null> {
  const db = await getDb();
  const { rows } = await db.query<ReactionRow>(
    "SELECT * FROM candidate_reactions WHERE user_id = $1 AND candidate_id = $2",
    [userId, candidateId]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function upsertCandidateReaction(
  userId: string,
  candidateId: string,
  reaction: Reaction,
  learned?: { summary: string; features: string[] } | null
): Promise<{ reaction: CandidateReaction; previous: CandidateReaction | null }> {
  const db = await getDb();
  const previous = await getCandidateReaction(userId, candidateId);
  const { rows } = await db.query<ReactionRow>(
    `INSERT INTO candidate_reactions
       (id, user_id, candidate_id, reaction, feature_summary, features)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, candidate_id)
     DO UPDATE SET reaction = EXCLUDED.reaction,
                   feature_summary = EXCLUDED.feature_summary,
                   features = EXCLUDED.features,
                   updated_at = now()
     RETURNING *`,
    [
      previous?.id ?? newId(),
      userId,
      candidateId,
      reaction,
      learned?.summary ?? null,
      stringifyJsonForDb(learned?.features ?? []),
    ]
  );
  return { reaction: toDomain(rows[0]), previous };
}

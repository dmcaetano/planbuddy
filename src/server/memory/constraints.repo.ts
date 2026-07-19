import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Constraint, ConstraintSource, ConstraintStatus } from "../../shared/types.js";

interface ConstraintRow {
  id: string;
  user_id: string;
  participant_id: string | null;
  text: string;
  status: ConstraintStatus;
  source: ConstraintSource;
  source_quote: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: ConstraintRow): Constraint {
  return {
    id: row.id,
    userId: row.user_id,
    participantId: row.participant_id,
    text: row.text,
    status: row.status,
    source: row.source,
    sourceQuote: row.source_quote,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConstraints(userId: string): Promise<Constraint[]> {
  const db = await getDb();
  const { rows } = await db.query<ConstraintRow>(
    "SELECT * FROM constraints WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(toDomain);
}

/** Active constraints (both verified and active-unverified) filter recommendations. */
export async function listActiveConstraints(userId: string): Promise<Constraint[]> {
  return listConstraints(userId);
}

export async function getConstraint(userId: string, id: string): Promise<Constraint | null> {
  const db = await getDb();
  const { rows } = await db.query<ConstraintRow>(
    "SELECT * FROM constraints WHERE user_id = $1 AND id = $2",
    [userId, id]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function createConstraint(
  userId: string,
  input: {
    participantId: string | null;
    text: string;
    status: ConstraintStatus;
    source: ConstraintSource;
    sourceQuote?: string | null;
    sourceMessageId?: string | null;
  }
): Promise<Constraint> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<ConstraintRow>(
    `INSERT INTO constraints
      (id, user_id, participant_id, text, status, source, source_quote, source_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      userId,
      input.participantId,
      input.text,
      input.status,
      input.source,
      input.sourceQuote ?? null,
      input.sourceMessageId ?? null,
    ]
  );
  return toDomain(rows[0]);
}

export async function updateConstraint(
  userId: string,
  id: string,
  input: { text?: string; participantId?: string | null; status?: ConstraintStatus }
): Promise<Constraint | null> {
  const db = await getDb();
  const existing = await getConstraint(userId, id);
  if (!existing) return null;
  const { rows } = await db.query<ConstraintRow>(
    `UPDATE constraints SET text = $3, participant_id = $4, status = $5, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      input.text ?? existing.text,
      input.participantId !== undefined ? input.participantId : existing.participantId,
      input.status ?? existing.status,
    ]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function deleteConstraint(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query("DELETE FROM constraints WHERE user_id = $1 AND id = $2 RETURNING id", [
    userId,
    id,
  ]);
  return rows.length > 0;
}

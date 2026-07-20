import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Taste, TastePolarity, TasteSource } from "../../shared/types.js";

interface TasteRow {
  id: string;
  user_id: string;
  participant_id: string | null;
  text: string;
  polarity: TastePolarity;
  weight: number;
  source: TasteSource;
  created_at: string;
  updated_at: string;
}

function toDomain(row: TasteRow): Taste {
  return {
    id: row.id,
    userId: row.user_id,
    participantId: row.participant_id,
    text: row.text,
    polarity: row.polarity,
    weight: row.weight,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTastes(userId: string): Promise<Taste[]> {
  const db = await getDb();
  const { rows } = await db.query<TasteRow>(
    "SELECT * FROM tastes WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(toDomain);
}

export async function getTaste(userId: string, id: string): Promise<Taste | null> {
  const db = await getDb();
  const { rows } = await db.query<TasteRow>("SELECT * FROM tastes WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function createTaste(
  userId: string,
  input: {
    participantId: string | null;
    text: string;
    polarity: TastePolarity;
    weight?: number;
    source?: TasteSource;
  }
): Promise<Taste> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<TasteRow>(
    `INSERT INTO tastes (id, user_id, participant_id, text, polarity, weight, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      userId,
      input.participantId,
      input.text,
      input.polarity,
      input.weight ?? 0.5,
      input.source ?? "stated",
    ]
  );
  return toDomain(rows[0]);
}

export async function updateTaste(
  userId: string,
  id: string,
  input: { text?: string; participantId?: string | null; polarity?: TastePolarity; weight?: number }
): Promise<Taste | null> {
  const db = await getDb();
  const existing = await getTaste(userId, id);
  if (!existing) return null;
  const { rows } = await db.query<TasteRow>(
    `UPDATE tastes SET text = $3, participant_id = $4, polarity = $5, weight = $6, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      input.text ?? existing.text,
      input.participantId !== undefined ? input.participantId : existing.participantId,
      input.polarity ?? existing.polarity,
      input.weight ?? existing.weight,
    ]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function deleteTaste(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query("DELETE FROM tastes WHERE user_id = $1 AND id = $2 RETURNING id", [
    userId,
    id,
  ]);
  return rows.length > 0;
}

/**
 * Bulk-removes every taste with a given source for this user. Used by the
 * taste quiz's retake flow so re-taking never duplicates previous answers —
 * the source acts as the provenance marker that scopes the wipe to
 * quiz-written rows only, leaving manually stated tastes untouched.
 */
export async function deleteTastesBySource(userId: string, source: TasteSource): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query(
    "DELETE FROM tastes WHERE user_id = $1 AND source = $2 RETURNING id",
    [userId, source]
  );
  return rows.length;
}

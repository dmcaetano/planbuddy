import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Participant, ParticipantKind } from "../../shared/types.js";

interface ParticipantRow {
  id: string;
  user_id: string;
  name: string;
  kind: ParticipantKind;
  relationship: string | null;
  is_owner: boolean;
  created_at: string;
}

function toDomain(row: ParticipantRow): Participant {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind,
    relationship: row.relationship,
    isOwner: row.is_owner,
    createdAt: row.created_at,
  };
}

export async function seedOwnerParticipant(userId: string): Promise<Participant> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<ParticipantRow>(
    `INSERT INTO participants (id, user_id, name, kind, relationship, is_owner)
     VALUES ($1, $2, 'You', 'person', NULL, true)
     RETURNING *`,
    [id, userId]
  );
  return toDomain(rows[0]);
}

export async function listParticipants(userId: string): Promise<Participant[]> {
  const db = await getDb();
  const { rows } = await db.query<ParticipantRow>(
    "SELECT * FROM participants WHERE user_id = $1 ORDER BY is_owner DESC, created_at ASC",
    [userId]
  );
  return rows.map(toDomain);
}

export async function getParticipant(userId: string, id: string): Promise<Participant | null> {
  const db = await getDb();
  const { rows } = await db.query<ParticipantRow>(
    "SELECT * FROM participants WHERE user_id = $1 AND id = $2",
    [userId, id]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function createParticipant(
  userId: string,
  input: { name: string; kind: ParticipantKind; relationship?: string | null }
): Promise<Participant> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<ParticipantRow>(
    `INSERT INTO participants (id, user_id, name, kind, relationship, is_owner)
     VALUES ($1, $2, $3, $4, $5, false)
     RETURNING *`,
    [id, userId, input.name, input.kind, input.relationship ?? null]
  );
  return toDomain(rows[0]);
}

export async function updateParticipant(
  userId: string,
  id: string,
  input: { name?: string; kind?: ParticipantKind; relationship?: string | null }
): Promise<Participant | null> {
  const db = await getDb();
  const existing = await getParticipant(userId, id);
  if (!existing) return null;
  const { rows } = await db.query<ParticipantRow>(
    `UPDATE participants SET name = $3, kind = $4, relationship = $5
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      input.name ?? existing.name,
      input.kind ?? existing.kind,
      input.relationship !== undefined ? input.relationship : existing.relationship,
    ]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function findParticipantByName(userId: string, name: string): Promise<Participant | null> {
  const db = await getDb();
  const { rows } = await db.query<ParticipantRow>(
    "SELECT * FROM participants WHERE user_id = $1 AND lower(name) = lower($2) LIMIT 1",
    [userId, name]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function deleteParticipant(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query(
    "DELETE FROM participants WHERE user_id = $1 AND id = $2 AND is_owner = false RETURNING id",
    [userId, id]
  );
  return rows.length > 0;
}

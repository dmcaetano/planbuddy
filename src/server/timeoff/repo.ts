import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { stringifyJsonForDb } from "../db/json.js";
import type { TimeOff, TripIdea } from "../../shared/momentTypes.js";

const COLUMNS = `id, label, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
  TO_CHAR(snoozed_until, 'YYYY-MM-DD') AS snoozed_until`;

interface TimeOffRow {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  snoozed_until: string | null;
}

function toDomain(row: TimeOffRow): TimeOff {
  return {
    id: row.id,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
    snoozedUntil: row.snoozed_until ?? null,
  };
}

export async function listTimeOff(userId: string): Promise<TimeOff[]> {
  const db = await getDb();
  const { rows } = await db.query<TimeOffRow>(
    `SELECT ${COLUMNS} FROM life_dates WHERE user_id = $1 ORDER BY start_date ASC, created_at ASC`,
    [userId]
  );
  return rows.map(toDomain);
}

export async function getTimeOff(userId: string, id: string): Promise<TimeOff | null> {
  const db = await getDb();
  const { rows } = await db.query<TimeOffRow>(`SELECT ${COLUMNS} FROM life_dates WHERE user_id = $1 AND id = $2`, [userId, id]);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function createTimeOff(
  userId: string,
  input: { label: string; startDate: string; endDate: string }
): Promise<TimeOff> {
  const db = await getDb();
  const { rows } = await db.query<TimeOffRow>(
    `INSERT INTO life_dates (id, user_id, label, start_date, end_date)
     VALUES ($1, $2, $3, $4::date, $5::date)
     RETURNING ${COLUMNS}`,
    [newId(), userId, input.label, input.startDate, input.endDate]
  );
  return toDomain(rows[0]);
}

/** Editing a range clears any snooze and drops its cached trip ideas (spec rules 19 and 23). */
export async function updateTimeOff(
  userId: string,
  id: string,
  input: { label?: string; startDate?: string; endDate?: string }
): Promise<TimeOff | null> {
  const existing = await getTimeOff(userId, id);
  if (!existing) return null;
  const label = input.label ?? existing.label;
  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate ?? existing.endDate;
  const db = await getDb();
  const { rows } = await db.query<TimeOffRow>(
    `UPDATE life_dates
     SET label = $3, start_date = $4::date, end_date = $5::date, snoozed_until = NULL, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING ${COLUMNS}`,
    [userId, id, label, startDate, endDate]
  );
  await db.query("DELETE FROM trip_ideas WHERE user_id = $1 AND life_date_id = $2", [userId, id]);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function deleteTimeOff(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  await db.query("DELETE FROM trip_ideas WHERE user_id = $1 AND life_date_id = $2", [userId, id]);
  const { rows } = await db.query<{ id: string }>("DELETE FROM life_dates WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]);
  return rows.length > 0;
}

export async function setSnoozedUntil(userId: string, id: string, until: string | null): Promise<TimeOff | null> {
  const db = await getDb();
  const { rows } = await db.query<TimeOffRow>(
    `UPDATE life_dates SET snoozed_until = $3::date, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING ${COLUMNS}`,
    [userId, id, until]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Date ranges of the user's locked Getaway or Vacation plans (a locked dinner or weekend never counts). */
export async function listLockedTripRanges(userId: string): Promise<{ startDate: string; endDate: string }[]> {
  const db = await getDb();
  const { rows } = await db.query<{ start_date: string; end_date: string }>(
    `SELECT TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(s.end_date, 'YYYY-MM-DD') AS end_date
     FROM plans p JOIN plan_specs s ON s.id = p.plan_spec_id
     WHERE p.user_id = $1 AND s.user_id = $1 AND p.status = 'locked' AND s.scale IN ('getaway', 'vacation')`,
    [userId]
  );
  return rows.map((row) => ({ startDate: row.start_date, endDate: row.end_date }));
}

export interface CachedIdeas {
  ideas: TripIdea[];
  tasteFingerprint: string;
  createdAt: string;
}

function parseIdeas(value: unknown): TripIdea[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  // jsonb does not keep key order; rebuild each idea so the shape is stable.
  return (parsed as TripIdea[]).map((idea) => ({ name: idea.name, reason: idea.reason, scope: idea.scope }));
}

/** The newest cached ideas row for a range, with its age in whole days (computed in SQL, one clock). */
export async function getCachedIdeas(
  userId: string,
  lifeDateId: string
): Promise<(CachedIdeas & { ageDays: number }) | null> {
  const db = await getDb();
  const { rows } = await db.query<{ ideas: unknown; taste_fingerprint: string; created_at: string; age_days: number }>(
    `SELECT ideas, taste_fingerprint, created_at,
            EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
     FROM trip_ideas WHERE user_id = $1 AND life_date_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, lifeDateId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ideas: parseIdeas(row.ideas),
    tasteFingerprint: row.taste_fingerprint,
    createdAt: String(row.created_at),
    ageDays: Number(row.age_days),
  };
}

export async function countCachedIdeas(userId: string, lifeDateId: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM trip_ideas WHERE user_id = $1 AND life_date_id = $2",
    [userId, lifeDateId]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Keeps only the newest row per range so the cache never grows. */
export async function saveCachedIdeas(
  userId: string,
  lifeDateId: string,
  tasteFingerprint: string,
  ideas: TripIdea[]
): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM trip_ideas WHERE user_id = $1 AND life_date_id = $2", [userId, lifeDateId]);
  await db.query(
    `INSERT INTO trip_ideas (id, user_id, life_date_id, taste_fingerprint, ideas) VALUES ($1, $2, $3, $4, $5)`,
    [newId(), userId, lifeDateId, tasteFingerprint, stringifyJsonForDb(ideas)]
  );
}

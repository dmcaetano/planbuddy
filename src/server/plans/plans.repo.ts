import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { toDateOnlyString } from "../db/dateUtil.js";
import type { Beat, Citation, PlanRecord, PlanStatus, WeatherSnapshot } from "../../shared/types.js";
import { stringifyJsonForDb } from "../db/json.js";

interface PlanRow {
  id: string;
  user_id: string;
  plan_spec_id: string;
  candidate_id: string;
  status: PlanStatus;
  title: string;
  rationale: string;
  category: string;
  beats: Beat[];
  weather: WeatherSnapshot | null;
  distance_km: number | null;
  place_provenance: { mode: "inspiration" | "resolved"; note: string };
  active_constraints: { id: string; text: string; status: string }[];
  rejection_reason: string | null;
  locked_at: string | null;
  created_at: string;
  spec_start_date: string;
  spec_end_date: string;
}

const SELECT_WITH_SPEC_DATES = `
  SELECT plans.*, plan_specs.start_date AS spec_start_date, plan_specs.end_date AS spec_end_date
  FROM plans JOIN plan_specs ON plans.plan_spec_id = plan_specs.id
`;

function toDomain(row: PlanRow, citations: Citation[]): PlanRecord {
  return {
    id: row.id,
    userId: row.user_id,
    planSpecId: row.plan_spec_id,
    candidateId: row.candidate_id,
    status: row.status,
    title: row.title,
    rationale: row.rationale,
    category: row.category,
    eventStartDate: toDateOnlyString(row.spec_start_date),
    eventEndDate: toDateOnlyString(row.spec_end_date),
    beats: row.beats,
    weather: row.weather,
    distanceKm: row.distance_km,
    placeProvenance: row.place_provenance,
    activeConstraints: row.active_constraints as PlanRecord["activeConstraints"],
    citations,
    rejectionReason: row.rejection_reason,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
  };
}

export interface PlanInsert {
  userId: string;
  planSpecId: string;
  candidateId: string;
  status: PlanStatus;
  title: string;
  rationale: string;
  category: string;
  beats: Beat[];
  weather: WeatherSnapshot | null;
  distanceKm: number | null;
  placeProvenance: { mode: "inspiration" | "resolved"; note: string };
  activeConstraints: { id: string; text: string; status: string }[];
  citations: Citation[];
  rejectionReason: string | null;
  locked: boolean;
}

export async function insertPlan(input: PlanInsert): Promise<PlanRecord> {
  const db = await getDb();
  const id = newId();
  await db.query(
    `INSERT INTO plans
      (id, user_id, plan_spec_id, candidate_id, status, title, rationale, category, beats,
       weather, distance_km, place_provenance, active_constraints, rejection_reason, locked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      input.userId,
      input.planSpecId,
      input.candidateId,
      input.status,
      input.title,
      input.rationale,
      input.category,
      stringifyJsonForDb(input.beats),
      input.weather ? stringifyJsonForDb(input.weather) : null,
      input.distanceKm,
      stringifyJsonForDb(input.placeProvenance),
      stringifyJsonForDb(input.activeConstraints),
      input.rejectionReason,
      input.locked ? new Date().toISOString() : null,
    ]
  );
  for (const citation of input.citations) {
    await db.query(
      `INSERT INTO citations (id, plan_id, fact_id, quote, source) VALUES ($1, $2, $3, $4, $5)`,
      [newId(), id, citation.factId, citation.quote, citation.source]
    );
  }
  const { rows } = await db.query<PlanRow>(`${SELECT_WITH_SPEC_DATES} WHERE plans.id = $1`, [id]);
  return toDomain(rows[0], input.citations);
}

async function citationsForPlan(planId: string): Promise<Citation[]> {
  const db = await getDb();
  const { rows } = await db.query<{ fact_id: string; quote: string; source: string }>(
    "SELECT fact_id, quote, source FROM citations WHERE plan_id = $1",
    [planId]
  );
  return rows.map((r) => ({ factId: r.fact_id, quote: r.quote, source: r.source }));
}

export async function getPlan(userId: string, id: string): Promise<PlanRecord | null> {
  const db = await getDb();
  const { rows } = await db.query<PlanRow>(
    `${SELECT_WITH_SPEC_DATES} WHERE plans.user_id = $1 AND plans.id = $2`,
    [userId, id]
  );
  if (!rows[0]) return null;
  const citations = await citationsForPlan(id);
  return toDomain(rows[0], citations);
}

export async function listPlans(userId: string): Promise<PlanRecord[]> {
  const db = await getDb();
  const { rows } = await db.query<PlanRow>(
    `${SELECT_WITH_SPEC_DATES} WHERE plans.user_id = $1 ORDER BY plans.created_at DESC`,
    [userId]
  );
  const results: PlanRecord[] = [];
  for (const row of rows) {
    results.push(toDomain(row, await citationsForPlan(row.id)));
  }
  return results;
}

export async function lastLockedPlans(userId: string, limit = 10): Promise<PlanRecord[]> {
  const db = await getDb();
  const { rows } = await db.query<PlanRow>(
    `${SELECT_WITH_SPEC_DATES} WHERE plans.user_id = $1 AND plans.status = 'locked'
     ORDER BY plans.locked_at DESC LIMIT $2`,
    [userId, limit]
  );
  const results: PlanRecord[] = [];
  for (const row of rows) {
    results.push(toDomain(row, await citationsForPlan(row.id)));
  }
  return results;
}

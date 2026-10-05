import { getDb } from "../db/client.js";
import { stringifyJsonForDb } from "../db/json.js";
import type { AiCandidate } from "../../shared/schemas.js";
import type { StoredMomentTimes } from "../../shared/momentTypes.js";
import type { Beat, Candidate, PlanRecord } from "../../shared/types.js";
import { getPlan } from "../plans/plans.repo.js";

/** The newest plan row (any status) whose spec carries this moment key and inputs fingerprint. */
export async function findNewestMomentPlan(userId: string, momentKey: string, fingerprint: string): Promise<PlanRecord | null> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `SELECT p.id
     FROM plans p JOIN plan_specs s ON s.id = p.plan_spec_id
     WHERE p.user_id = $1 AND s.user_id = $1 AND s.moment_key = $2 AND s.inputs_fingerprint = $3
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT 1`,
    [userId, momentKey, fingerprint]
  );
  return rows[0] ? getPlan(userId, rows[0].id) : null;
}

/** Locked plans whose spec date range includes `planDate` (spec rule 8, date-range overlap). */
export async function listLockedPlansCovering(userId: string, planDate: string): Promise<PlanRecord[]> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `SELECT p.id
     FROM plans p JOIN plan_specs s ON s.id = p.plan_spec_id
     WHERE p.user_id = $1 AND s.user_id = $1 AND p.status = 'locked'
       AND s.start_date <= $2::date AND s.end_date >= $2::date
     ORDER BY p.locked_at DESC NULLS LAST, p.created_at DESC`,
    [userId, planDate]
  );
  const plans: PlanRecord[] = [];
  for (const row of rows) {
    const plan = await getPlan(userId, row.id);
    if (plan) plans.push(plan);
  }
  return plans;
}

/** Points an existing History row at a retimed candidate (spec rule 6): no new row is created. */
export async function repointPlan(
  userId: string,
  planId: string,
  candidateId: string,
  planSpecId: string,
  beats: Beat[]
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE plans SET candidate_id = $3, plan_spec_id = $4, beats = $5
     WHERE id = $1 AND user_id = $2`,
    [planId, userId, candidateId, planSpecId, stringifyJsonForDb(beats)]
  );
}

/** Refreshes the stored timing of a moment spec when it is regenerated from a later open. */
export async function updateSpecMomentTiming(
  userId: string,
  specId: string,
  moodContext: string,
  times: StoredMomentTimes
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE plan_specs SET mood_context = $3, moment_times = $4 WHERE user_id = $1 AND id = $2`,
    [userId, specId, moodContext, stringifyJsonForDb(times)]
  );
}

/** The spec id of the user's queued or running generation job, if any. */
export async function findActiveJob(userId: string): Promise<{ jobId: string; specId: string | null } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string; request_payload: unknown }>(
    `SELECT id, request_payload FROM plan_generation_jobs
     WHERE user_id = $1 AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (!rows[0]) return null;
  let payload: unknown = rows[0].request_payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  const specId = (payload as { specId?: unknown } | null)?.specId;
  return { jobId: rows[0].id, specId: typeof specId === "string" ? specId : null };
}

/** A stored candidate as the JSON payload shape `insertCandidates` expects. */
export function candidateToPayload(candidate: Candidate, beats: Beat[], dropRouteLink: boolean): AiCandidate {
  return {
    title: candidate.title,
    rationale: candidate.rationale,
    category: candidate.category,
    indoor: candidate.indoor,
    beats,
    walkingDistanceKm: candidate.walkingDistanceKm,
    walkingMinutes: candidate.walkingMinutes,
    estimatedCost: candidate.estimatedCost,
    checkBeforeYouGo: candidate.checkBeforeYouGo,
    fallback: candidate.fallback,
    photoSearchTerm: candidate.photoSearchTerm,
    heroImage: candidate.heroImage,
    routeMapsUrl: dropRouteLink ? null : candidate.routeMapsUrl,
    preparation: candidate.preparation,
    destinationAnchor: candidate.destinationAnchor,
    resolverVenueIds: [],
    citations: candidate.citations,
    constraintCompliance: candidate.constraintCompliance,
    travelEstimateKm: candidate.travelEstimateKm,
  };
}

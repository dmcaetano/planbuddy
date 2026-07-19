import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { AiCandidate } from "../../shared/schemas.js";
import type { Candidate, ScoreBreakdown } from "../../shared/types.js";

interface CandidateRow {
  id: string;
  plan_spec_id: string;
  payload: AiCandidate;
  score_breakdown: ScoreBreakdown | null;
  rank: number | null;
  rejected: boolean;
  rejection_reason: string | null;
  created_at: string;
}

function toDomain(row: CandidateRow): Candidate {
  const p = row.payload;
  return {
    id: row.id,
    planSpecId: row.plan_spec_id,
    title: p.title,
    rationale: p.rationale,
    category: p.category,
    indoor: p.indoor,
    beats: p.beats,
    walkingDistanceKm: p.walkingDistanceKm ?? null,
    walkingMinutes: p.walkingMinutes ?? null,
    estimatedCost: p.estimatedCost ?? null,
    checkBeforeYouGo: p.checkBeforeYouGo ?? [],
    fallback: p.fallback ?? null,
    photoSearchTerm: p.photoSearchTerm ?? null,
    heroImage: p.heroImage ?? null,
    routeMapsUrl: p.routeMapsUrl ?? null,
    preparation: p.preparation ?? null,
    destinationAnchor: p.destinationAnchor ?? null,
    travelEstimateKm: p.travelEstimateKm ?? null,
    citations: p.citations,
    constraintCompliance: p.constraintCompliance.map((c) => ({ constraintId: c.constraintId, satisfied: c.satisfied })),
    scoreBreakdown: row.score_breakdown ?? {
      groupFit: 0,
      feasibility: 0,
      novelty: 0,
      finalScore: 0,
      perParticipantFit: {},
    },
    rank: row.rank ?? 0,
    rejected: row.rejected,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

export interface CandidateInsert {
  payload: AiCandidate;
  scoreBreakdown: ScoreBreakdown | null;
  rank: number | null;
  rejected: boolean;
  rejectionReason: string | null;
}

export async function insertCandidates(planSpecId: string, items: CandidateInsert[]): Promise<Candidate[]> {
  const db = await getDb();
  const results: Candidate[] = [];
  for (const item of items) {
    const id = newId();
    const { rows } = await db.query<CandidateRow>(
      `INSERT INTO candidates (id, plan_spec_id, payload, score_breakdown, rank, rejected, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        planSpecId,
        JSON.stringify(item.payload),
        item.scoreBreakdown ? JSON.stringify(item.scoreBreakdown) : null,
        item.rank,
        item.rejected,
        item.rejectionReason,
      ]
    );
    results.push(toDomain(rows[0]));
  }
  return results;
}

export async function getCandidate(id: string): Promise<Candidate | null> {
  const db = await getDb();
  const { rows } = await db.query<CandidateRow>("SELECT * FROM candidates WHERE id = $1", [id]);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function listCandidatesForSpec(planSpecId: string): Promise<Candidate[]> {
  const db = await getDb();
  const { rows } = await db.query<CandidateRow>(
    "SELECT * FROM candidates WHERE plan_spec_id = $1 ORDER BY rank ASC NULLS LAST, created_at ASC",
    [planSpecId]
  );
  return rows.map(toDomain);
}

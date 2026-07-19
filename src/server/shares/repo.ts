import crypto from "node:crypto";
import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { stringifyJsonForDb } from "../db/json.js";
import type { Candidate, PlanSpec, WeatherSnapshot } from "../../shared/types.js";

const SHARE_TTL_DAYS = 30;

export interface SharedPlanSnapshot {
  title: string;
  startDate: string;
  endDate: string;
  candidate: Candidate;
  weather: WeatherSnapshot;
  placeProvenance: { mode: "inspiration" | "resolved"; note: string };
}

interface ShareRow {
  id: string;
  user_id: string;
  candidate_id: string;
  token_hash: string;
  snapshot: SharedPlanSnapshot;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function buildPublicSnapshot(
  spec: PlanSpec,
  candidate: Candidate,
  weather: WeatherSnapshot,
  placeProvenance: SharedPlanSnapshot["placeProvenance"],
  privateTerms: string[]
): SharedPlanSnapshot {
  const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const redact = (value: string): string => {
    let safe = value;
    const publicPronouns = new Set(["i", "me", "my", "you", "your", "yours", "self", "owner"]);
    for (const term of privateTerms.filter((item) => item.trim().length >= 3)) {
      const normalized = term.trim().toLowerCase();
      if (publicPronouns.has(normalized)) continue;
      safe = safe.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term.trim())}(?![\\p{L}\\p{N}])`, "giu"),
        "your group"
      );
    }
    return safe;
  };
  const publicCandidate: Candidate = {
    id: "shared",
    planSpecId: "shared",
    title: redact(candidate.title),
    rationale: redact(candidate.rationale),
    category: candidate.category,
    indoor: candidate.indoor,
    beats: candidate.beats.map((beat, index) => ({
      title: redact(beat.title),
      description: redact(beat.description),
      category: beat.category,
      indoor: beat.indoor,
      startTime: beat.startTime ?? null,
      durationMinutes: beat.durationMinutes ?? null,
      travelMode: beat.travelMode ?? null,
      distanceFromPreviousKm: beat.distanceFromPreviousKm ?? null,
      travelMinutes: beat.travelMinutes ?? null,
      place: beat.place
        ? {
            name: beat.place.name,
            address: beat.place.address ?? null,
            kind: beat.place.kind,
            sourceUrl: beat.place.sourceUrl,
            sourceLabel: beat.place.sourceLabel,
            factualNote: redact(beat.place.factualNote),
            mapsUrl: beat.place.mapsUrl ?? null,
          }
        : null,
      directionsUrl: index === 0 ? null : beat.directionsUrl ?? null,
    })),
    walkingDistanceKm: candidate.walkingDistanceKm,
    walkingMinutes: candidate.walkingMinutes,
    estimatedCost: candidate.estimatedCost,
    checkBeforeYouGo: candidate.checkBeforeYouGo.map(redact),
    fallback: candidate.fallback
      ? {
          title: redact(candidate.fallback.title),
          description: redact(candidate.fallback.description),
          place: candidate.fallback.place
            ? {
                name: candidate.fallback.place.name,
                address: candidate.fallback.place.address ?? null,
                kind: candidate.fallback.place.kind,
                sourceUrl: candidate.fallback.place.sourceUrl,
                sourceLabel: candidate.fallback.place.sourceLabel,
                factualNote: redact(candidate.fallback.place.factualNote),
                mapsUrl: candidate.fallback.place.mapsUrl ?? null,
              }
            : null,
        }
      : null,
    photoSearchTerm: candidate.photoSearchTerm,
    heroImage: candidate.heroImage
      ? {
          url: candidate.heroImage.url,
          sourceUrl: candidate.heroImage.sourceUrl,
          attribution: candidate.heroImage.attribution,
          caption: redact(candidate.heroImage.caption),
        }
      : null,
    routeMapsUrl: candidate.routeMapsUrl,
    preparation: candidate.preparation
      ? {
          wear: candidate.preparation.wear.map(redact),
          bring: candidate.preparation.bring.map(redact),
          pet: candidate.preparation.pet.map(redact),
          weatherRule: redact(candidate.preparation.weatherRule),
        }
      : null,
    destinationAnchor: candidate.destinationAnchor,
    travelEstimateKm: candidate.travelEstimateKm,
    citations: [],
    constraintCompliance: [],
    scoreBreakdown: {
      groupFit: candidate.scoreBreakdown.groupFit,
      feasibility: candidate.scoreBreakdown.feasibility,
      novelty: candidate.scoreBreakdown.novelty,
      finalScore: candidate.scoreBreakdown.finalScore,
      perParticipantFit: {},
    },
    rank: 1,
    rejected: false,
    rejectionReason: null,
    createdAt: candidate.createdAt,
  };
  return {
    title: publicCandidate.title,
    startDate: spec.startDate,
    endDate: spec.endDate,
    candidate: publicCandidate,
    weather,
    placeProvenance,
  };
}

export async function createPlanShare(
  userId: string,
  candidateId: string,
  snapshot: SharedPlanSnapshot
): Promise<{ id: string; token: string; expiresAt: string }> {
  const db = await getDb();
  const id = newId();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO plan_shares (id, user_id, candidate_id, token_hash, snapshot, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, candidateId, tokenHash(token), stringifyJsonForDb(snapshot), expiresAt]
  );
  return { id, token, expiresAt };
}

export async function getPlanShare(token: string): Promise<SharedPlanSnapshot | null> {
  const db = await getDb();
  const { rows } = await db.query<ShareRow>(
    `SELECT * FROM plan_shares
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash(token)]
  );
  return rows[0]?.snapshot ?? null;
}

export async function revokePlanShare(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `UPDATE plan_shares SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}

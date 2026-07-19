import type { AiCandidate } from "../../../shared/schemas.js";
import type { Hunch, Taste, WeatherSnapshot } from "../../../shared/types.js";
import { HUNCH_MAX_CONTRIBUTION } from "../../memory/hunches.repo.js";

const STOPWORDS = new Set([
  "the", "and", "with", "for", "that", "this", "have", "from", "your", "their",
  "about", "into", "over", "then", "than", "very", "really", "just", "like",
  "loves", "love", "avoid", "avoids", "hate", "hates", "dislike", "dislikes",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export function candidateText(c: AiCandidate): string {
  return [c.title, c.rationale, c.category, ...c.beats.map((b) => `${b.title} ${b.description}`)]
    .join(" ")
    .toLowerCase();
}

export function textMatches(factText: string, candidateFullText: string): boolean {
  const words = tokens(factText);
  if (words.length === 0) return candidateFullText.includes(factText.toLowerCase().trim());
  return words.some((w) => candidateFullText.includes(w));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface ParticipantMemory {
  participantId: string;
  tastes: Taste[]; // tastes scoped to this participant OR household-wide (participantId null)
  hunches: Hunch[]; // active hunches scoped to this participant OR household-wide
}

export function participantFit(candidate: AiCandidate, memory: ParticipantMemory): number {
  const text = candidateText(candidate);
  let fit = 0.5;

  for (const taste of memory.tastes) {
    if (textMatches(taste.text, text)) {
      const delta = clamp(taste.weight, 0, 1) * 0.35;
      fit += taste.polarity === "love" ? delta : -delta;
    }
  }

  for (const hunch of memory.hunches) {
    if (hunch.status !== "active") continue;
    if (textMatches(hunch.text, text)) {
      const delta = Math.min(HUNCH_MAX_CONTRIBUTION, hunch.confidence * HUNCH_MAX_CONTRIBUTION);
      fit += hunch.polarity === "love" ? delta : -delta;
    }
  }

  return clamp(fit, 0, 1);
}

export function groupFit(candidate: AiCandidate, memories: ParticipantMemory[]): {
  groupFit: number;
  perParticipantFit: Record<string, number>;
} {
  if (memories.length === 0) return { groupFit: 0.5, perParticipantFit: {} };
  const perParticipantFit: Record<string, number> = {};
  let min = 1;
  for (const memory of memories) {
    const fit = participantFit(candidate, memory);
    perParticipantFit[memory.participantId] = fit;
    min = Math.min(min, fit);
  }
  return { groupFit: min, perParticipantFit };
}

export function feasibility(
  candidate: AiCandidate,
  weather: WeatherSnapshot | null,
  radiusKm: number
): number {
  let score = 0.8;
  if (weather && !weather.unavailable) {
    if (!candidate.indoor && weather.precipitationProbability != null && weather.precipitationProbability > 60) {
      score -= 0.3;
    }
    if (!candidate.indoor && weather.temperatureC != null && (weather.temperatureC < 0 || weather.temperatureC > 35)) {
      score -= 0.2;
    }
  }
  if (candidate.travelEstimateKm != null && radiusKm > 0) {
    const ratio = candidate.travelEstimateKm / radiusKm;
    if (ratio > 1) score -= Math.min(0.4, (ratio - 1) * 0.4);
  }
  return clamp(score, 0, 1);
}

export interface RecentPlanSummary {
  title: string;
  category: string;
  placeNames: string[];
}

export function novelty(candidate: AiCandidate, recentPlans: RecentPlanSummary[]): number {
  let score = 1;
  const sameCategory = recentPlans.filter((p) => p.category === candidate.category).length;
  score -= Math.min(0.3, sameCategory * 0.08);
  if (recentPlans.some((p) => p.title.trim().toLowerCase() === candidate.title.trim().toLowerCase())) {
    score -= 0.4;
  }
  const normalizePlace = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const candidatePlaces = new Set(
    candidate.beats.map((beat) => beat.place?.name).filter((name): name is string => Boolean(name)).map(normalizePlace)
  );
  if (candidatePlaces.size > 0) {
    let strongestOverlap = 0;
    for (const plan of recentPlans) {
      const recentPlaces = new Set(plan.placeNames.map(normalizePlace));
      const overlap = [...candidatePlaces].filter((name) => recentPlaces.has(name)).length / candidatePlaces.size;
      strongestOverlap = Math.max(strongestOverlap, overlap);
    }
    score -= strongestOverlap * 0.75;
  }
  return clamp(score, 0, 1);
}

export interface ScoredCandidate {
  candidate: AiCandidate;
  groupFit: number;
  perParticipantFit: Record<string, number>;
  feasibility: number;
  novelty: number;
  finalScore: number;
}

const WEIGHTS = { groupFit: 0.55, feasibility: 0.25, novelty: 0.2 };

export function scoreCandidates(
  candidates: AiCandidate[],
  memories: ParticipantMemory[],
  weather: WeatherSnapshot | null,
  radiusKm: number,
  recentPlans: RecentPlanSummary[]
): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const { groupFit: gf, perParticipantFit } = groupFit(candidate, memories);
      const feas = feasibility(candidate, weather, radiusKm);
      const nov = novelty(candidate, recentPlans);
      const finalScore = gf * WEIGHTS.groupFit + feas * WEIGHTS.feasibility + nov * WEIGHTS.novelty;
      return { candidate, groupFit: gf, perParticipantFit, feasibility: feas, novelty: nov, finalScore };
    })
    .sort((a, b) => {
      const diff = b.finalScore - a.finalScore;
      if (Math.abs(diff) > 0.01) return diff;
      return b.novelty - a.novelty; // novelty breaks near ties
    });
}

/** Alternates must pass identical filters (already applied) and be category/energy diverse from the winner. */
export function pickDiverseAlternates(ranked: ScoredCandidate[], count: number): ScoredCandidate[] {
  if (ranked.length === 0) return [];
  const [winner, ...rest] = ranked;
  const alternates: ScoredCandidate[] = [];
  const usedCategories = new Set([winner.candidate.category]);
  for (const sc of rest) {
    if (alternates.length >= count) break;
    if (!usedCategories.has(sc.candidate.category)) {
      alternates.push(sc);
      usedCategories.add(sc.candidate.category);
    }
  }
  // Backfill with next-best if not enough distinct categories were available.
  for (const sc of rest) {
    if (alternates.length >= count) break;
    if (!alternates.includes(sc)) alternates.push(sc);
  }
  return alternates;
}

import type { Constraint, Participant, PlanSpec, Taste, Hunch, WeatherSnapshot } from "../../../shared/types.js";
import { isTripScale } from "../../../shared/scale.js";
import { listParticipants } from "../../participants/repo.js";
import { listActiveConstraints } from "../../memory/constraints.repo.js";
import { listTastes } from "../../memory/tastes.repo.js";
import { listActiveHunches, bumpPlansSinceEvidence } from "../../memory/hunches.repo.js";
import { getUserById } from "../../users/repo.js";
import { getForecast } from "../../weather/openMeteo.js";
import { resolvePlaces, type PlaceResolverResult } from "../../resolver/placeResolver.js";
import { lastLockedPlans } from "../plans.repo.js";
import { insertCandidates, type CandidateInsert } from "../candidates.repo.js";
import { generateCandidates, type MemoryFact, type GenerateContext } from "../../ai/index.js";
import { filterCandidates } from "./filter.js";
import { scoreCandidates, pickDiverseAlternates, type ParticipantMemory, type ScoredCandidate } from "./scoring.js";
import type { Candidate } from "../../../shared/types.js";

export interface PlanContext {
  selectedParticipants: Participant[];
  scopedConstraints: Constraint[];
  scopedTastes: Taste[];
  scopedHunches: Hunch[];
  weather: WeatherSnapshot;
  resolver: PlaceResolverResult;
  knownFacts: Map<string, string>;
}

export async function gatherPlanContext(userId: string, spec: PlanSpec): Promise<PlanContext> {
  const [allParticipants, allConstraints, allTastes, allHunches, user] = await Promise.all([
    listParticipants(userId),
    listActiveConstraints(userId),
    listTastes(userId),
    listActiveHunches(userId),
    getUserById(userId),
  ]);

  const selectedParticipants = allParticipants.filter((p) => spec.participantIds.includes(p.id));
  const inScope = (participantId: string | null) =>
    participantId === null || spec.participantIds.includes(participantId);

  const scopedConstraints = allConstraints.filter((c) => inScope(c.participantId));
  const scopedTastes = allTastes.filter((t) => inScope(t.participantId));
  const scopedHunches = allHunches.filter((h) => inScope(h.participantId));

  const weather: WeatherSnapshot =
    user?.homeBaseLat != null && user?.homeBaseLng != null
      ? await getForecast(user.homeBaseLat, user.homeBaseLng, spec.startDate, spec.endDate)
      : { temperatureC: null, precipitationProbability: null, summary: "Weather unavailable", unavailable: true };

  const resolver: PlaceResolverResult =
    user?.homeBaseLat != null && user?.homeBaseLng != null
      ? await resolvePlaces(user.homeBaseLat, user.homeBaseLng, spec.radiusKm)
      : { mode: "inspiration", venues: [] };

  const knownFacts = new Map<string, string>();
  for (const t of scopedTastes) knownFacts.set(t.id, t.text);
  for (const c of scopedConstraints) knownFacts.set(c.id, c.text);

  return { selectedParticipants, scopedConstraints, scopedTastes, scopedHunches, weather, resolver, knownFacts };
}

export function activeConstraintsView(
  scopedConstraints: Constraint[]
): { id: string; text: string; status: string }[] {
  return scopedConstraints.map((c) => ({ id: c.id, text: c.text, status: c.status }));
}

export function placeProvenanceView(resolver: PlaceResolverResult): { mode: "inspiration" | "resolved"; note: string } {
  return resolver.mode === "resolved"
    ? { mode: "resolved", note: "Backed by a live place-resolver lookup." }
    : {
        mode: "inspiration",
        note: "Inspiration mode: names permanent geography and categories, but no live venue payload backs specific facts.",
      };
}

export interface PipelineResult {
  aiMode: "deepseek" | "demo";
  winner: Candidate | null;
  alternates: Candidate[];
  rejectedCount: number;
  deadEnd: boolean;
  deadEndReasons: string[];
  context: PlanContext;
}

const ALTERNATE_COUNT = 2;

export async function runGeneration(userId: string, spec: PlanSpec, batchIndex: number): Promise<PipelineResult> {
  const context = await gatherPlanContext(userId, spec);
  const { selectedParticipants, scopedConstraints, scopedTastes, scopedHunches, weather, resolver, knownFacts } =
    context;

  const recentPlans = await lastLockedPlans(userId, 10);

  const loveTastes: MemoryFact[] = scopedTastes
    .filter((t) => t.polarity === "love")
    .map((t) => ({
      id: t.id,
      text: t.text,
      source: "taste" as const,
      tags: t.text.toLowerCase().split(/\W+/).filter(Boolean),
    }));

  const genCtx: GenerateContext = {
    scale: spec.scale,
    moodContext: spec.moodContext,
    radiusKm: spec.radiusKm,
    activeConstraints: scopedConstraints.map((c) => ({ id: c.id, text: c.text })),
    loveTastes,
    seed: `${spec.id}:${batchIndex}`,
  };

  const { mode, response } = await generateCandidates(genCtx);

  const { kept, rejected } = filterCandidates(response.candidates, {
    activeConstraints: scopedConstraints.map((c) => ({ id: c.id, text: c.text })),
    knownFacts,
    resolverMode: resolver.mode,
    radiusKm: spec.radiusKm,
    isTripScale: isTripScale(spec.scale),
  });

  const memories: ParticipantMemory[] = selectedParticipants.map((p) => ({
    participantId: p.id,
    tastes: scopedTastes.filter((t) => t.participantId === null || t.participantId === p.id),
    hunches: scopedHunches.filter((h) => h.participantId === null || h.participantId === p.id),
  }));

  const recentSummaries = recentPlans.map((p) => ({ title: p.title, category: p.category }));
  const ranked: ScoredCandidate[] = scoreCandidates(kept, memories, weather, spec.radiusKm, recentSummaries);

  const inserts: CandidateInsert[] = [
    ...ranked.map((sc, idx) => ({
      payload: sc.candidate,
      scoreBreakdown: {
        groupFit: sc.groupFit,
        feasibility: sc.feasibility,
        novelty: sc.novelty,
        finalScore: sc.finalScore,
        perParticipantFit: sc.perParticipantFit,
      },
      rank: idx + 1,
      rejected: false,
      rejectionReason: null,
    })),
    ...rejected.map((r) => ({
      payload: r.candidate,
      scoreBreakdown: null,
      rank: null,
      rejected: true,
      rejectionReason: r.reason,
    })),
  ];

  const savedCandidates = await insertCandidates(spec.id, inserts);
  const savedRanked = savedCandidates.slice(0, ranked.length);

  await bumpPlansSinceEvidence(userId);

  if (savedRanked.length === 0) {
    return {
      aiMode: mode,
      winner: null,
      alternates: [],
      rejectedCount: rejected.length,
      deadEnd: true,
      deadEndReasons: rejected.map((r) => r.reason),
      context,
    };
  }

  const winner = savedRanked[0];
  const alternateScored = pickDiverseAlternates(ranked, ALTERNATE_COUNT);
  const alternates = alternateScored
    .map((sc) => savedRanked.find((c) => c.title === sc.candidate.title))
    .filter((c): c is Candidate => Boolean(c));

  return {
    aiMode: mode,
    winner,
    alternates,
    rejectedCount: rejected.length,
    deadEnd: false,
    deadEndReasons: [],
    context,
  };
}

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
import type { GroundingSource } from "../../ai/deepseek.js";
import { enrichCandidate } from "./enrich.js";

export interface PlanContext {
  selectedParticipants: Participant[];
  scopedConstraints: Constraint[];
  scopedTastes: Taste[];
  scopedHunches: Hunch[];
  weather: WeatherSnapshot;
  resolver: PlaceResolverResult;
  knownFacts: Map<string, string>;
  homeBaseLabel: string | null;
  homeBaseLat: number | null;
  homeBaseLng: number | null;
  groundingSources: GroundingSource[];
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
      : {
          temperatureC: null,
          temperatureMinC: null,
          apparentTemperatureC: null,
          precipitationProbability: null,
          windSpeedKph: null,
          uvIndex: null,
          sunrise: null,
          sunset: null,
          summary: "Weather unavailable",
          unavailable: true,
        };

  const resolver: PlaceResolverResult =
    user?.homeBaseLat != null && user?.homeBaseLng != null
      ? await resolvePlaces(user.homeBaseLat, user.homeBaseLng, spec.radiusKm)
      : { mode: "inspiration", venues: [] };

  const knownFacts = new Map<string, string>();
  for (const t of scopedTastes) knownFacts.set(t.id, t.text);
  for (const c of scopedConstraints) knownFacts.set(c.id, c.text);

  return {
    selectedParticipants,
    scopedConstraints,
    scopedTastes,
    scopedHunches,
    weather,
    resolver,
    knownFacts,
    homeBaseLabel: user?.homeBaseLabel ?? null,
    homeBaseLat: user?.homeBaseLat ?? null,
    homeBaseLng: user?.homeBaseLng ?? null,
    groundingSources: [],
  };
}

export function activeConstraintsView(
  scopedConstraints: Constraint[]
): { id: string; text: string; status: string }[] {
  return scopedConstraints.map((c) => ({ id: c.id, text: c.text, status: c.status }));
}

export function placeProvenanceView(
  resolver: PlaceResolverResult,
  groundingSources: GroundingSource[] = []
): { mode: "inspiration" | "resolved"; note: string } {
  return groundingSources.length > 0
    ? {
        mode: "resolved",
        note: `Named places are backed by ${groundingSources.length} current web source${groundingSources.length === 1 ? "" : "s"}. Maps routes are live; distances remain estimates. Check hours, booking, prices, and pet policy before leaving.`,
      }
    : resolver.mode === "resolved"
      ? { mode: "resolved", note: "Named places are backed by a live place-resolver lookup." }
    : {
        mode: "inspiration",
        note: "Inspiration mode: names permanent geography and categories, but no live venue payload backs specific facts.",
      };
}

export interface PipelineResult {
  aiMode: "deepseek" | "gemini-grounded" | "demo";
  winner: Candidate | null;
  alternates: Candidate[];
  rejectedCount: number;
  deadEnd: boolean;
  deadEndReasons: string[];
  context: PlanContext;
}

const ALTERNATE_COUNT = 0;

function walkingTargetFromMemory(texts: (string | null | undefined)[]): { min: number; max: number } | null {
  for (const text of texts) {
    const match = text?.match(/\b(\d{1,3})\s*(?:[-\u2013\u2014]|to)\s*(\d{1,3})\s*(?:minutes?|mins?)\b/i);
    if (!match) continue;
    const min = Number(match[1]);
    const max = Number(match[2]);
    if (min >= 10 && max >= min && max <= 240) return { min, max };
  }
  return null;
}

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
    startDate: spec.startDate,
    endDate: spec.endDate,
    homeBaseLabel: context.homeBaseLabel,
    homeBaseLat: context.homeBaseLat,
    homeBaseLng: context.homeBaseLng,
    participants: selectedParticipants.map((p) => ({ name: p.name, kind: p.kind, relationship: p.relationship })),
    weather,
    moodContext: spec.moodContext,
    radiusKm: spec.radiusKm,
    activeConstraints: scopedConstraints.map((c) => ({ id: c.id, text: c.text })),
    loveTastes,
    avoidTastes: scopedTastes
      .filter((t) => t.polarity === "avoid")
      .map((t) => ({ id: t.id, text: t.text, source: "taste" as const })),
    preferenceHunches: scopedHunches.map((h) => ({
      text: h.text,
      polarity: h.polarity,
      confidence: h.confidence,
    })),
    seed: `${spec.id}:${batchIndex}`,
  };

  const { mode, response, groundingSources } = await generateCandidates(genCtx);
  context.groundingSources = groundingSources;

  const { kept, rejected } = filterCandidates(response.candidates, {
    activeConstraints: scopedConstraints.map((c) => ({ id: c.id, text: c.text })),
    knownFacts,
    resolverMode: resolver.mode,
    groundedSourceUrls: groundingSources.map((source) => source.url),
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
  const enrichedRanked: ScoredCandidate[] = await Promise.all(
    ranked.map(async (sc) => ({
      ...sc,
      candidate: await enrichCandidate(sc.candidate, {
        homeBaseLabel: context.homeBaseLabel,
        weather,
        participants: selectedParticipants,
        walkingTargetMinutes: walkingTargetFromMemory([
          spec.moodContext,
          ...scopedTastes.map((taste) => taste.text),
        ]),
      }),
    }))
  );

  const inserts: CandidateInsert[] = [
    ...enrichedRanked.map((sc, idx) => ({
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
  const savedRanked = savedCandidates.slice(0, enrichedRanked.length);

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

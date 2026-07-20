import type { Constraint, Participant, PlanSpec, Taste, Hunch, WeatherSnapshot } from "../../../shared/types.js";
import { isTripScale } from "../../../shared/scale.js";
import { listAuthorizedPlanningParticipants } from "../../friends/repo.js";
import { listActiveConstraints } from "../../memory/constraints.repo.js";
import { listTastes } from "../../memory/tastes.repo.js";
import { listActiveHunches, bumpPlansSinceEvidence } from "../../memory/hunches.repo.js";
import { getUserById } from "../../users/repo.js";
import { getForecast } from "../../weather/openMeteo.js";
import { resolvePlaces, type PlaceResolverResult } from "../../resolver/placeResolver.js";
import { insertPlan, lastSurfacedPlans } from "../plans.repo.js";
import { insertCandidates, type CandidateInsert } from "../candidates.repo.js";
import { generateCandidates, type MemoryFact, type GenerateContext } from "../../ai/index.js";
import { filterCandidates } from "./filter.js";
import { scoreCandidates, pickDiverseAlternates, type ParticipantMemory, type ScoredCandidate } from "./scoring.js";
import type { Candidate } from "../../../shared/types.js";
import type { GroundingSource } from "../../ai/deepseek.js";
import { enrichCandidate } from "./enrich.js";
import { HttpError } from "../../http.js";
import type { AiCandidate } from "../../../shared/schemas.js";
import type { ProgressReporter } from "./stages.js";

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
  privateMemoryFactIds: Set<string>;
}

export async function gatherPlanContext(userId: string, spec: PlanSpec, report?: ProgressReporter): Promise<PlanContext> {
  await report?.("loading_memory");
  const [authorizedParticipants, user] = await Promise.all([
    listAuthorizedPlanningParticipants(userId),
    getUserById(userId),
  ]);
  const selectedParticipants = authorizedParticipants.filter((participant) => spec.participantIds.includes(participant.id));
  if (selectedParticipants.length !== new Set(spec.participantIds).size) {
    throw new HttpError(409, "A selected friend is no longer available for planning. Update who's in and try again.");
  }

  const selectedUserIds = Array.from(new Set(selectedParticipants.map((participant) => participant.userId)));
  const memoryByUser = new Map<
    string,
    { constraints: Constraint[]; tastes: Taste[]; hunches: Hunch[] }
  >();
  await Promise.all(
    selectedUserIds.map(async (memoryUserId) => {
      const [constraints, tastes, hunches] = await Promise.all([
        listActiveConstraints(memoryUserId),
        listTastes(memoryUserId),
        memoryUserId === userId ? listActiveHunches(memoryUserId) : Promise.resolve([]),
      ]);
      memoryByUser.set(memoryUserId, { constraints, tastes, hunches });
    })
  );

  const appliesToParticipant = (
    memory: { userId: string; participantId: string | null },
    participant: Participant
  ) => memory.userId === participant.userId && (memory.participantId === null || memory.participantId === participant.id);
  const uniqueById = <T extends { id: string }>(items: T[]) => Array.from(new Map(items.map((item) => [item.id, item])).values());
  const scopedConstraints = uniqueById(
    selectedParticipants.flatMap((participant) =>
      (memoryByUser.get(participant.userId)?.constraints ?? []).filter(
        (constraint) => appliesToParticipant(constraint, participant) &&
          (participant.userId === userId || constraint.status === "verified")
      )
    )
  );
  const scopedTastes = uniqueById(
    selectedParticipants.flatMap((participant) =>
      (memoryByUser.get(participant.userId)?.tastes ?? []).filter((taste) => appliesToParticipant(taste, participant))
    )
  );
  const scopedHunches = uniqueById(
    selectedParticipants.flatMap((participant) =>
      (memoryByUser.get(participant.userId)?.hunches ?? []).filter((hunch) => appliesToParticipant(hunch, participant))
    )
  );
  const privateMemoryFactIds = new Set(
    [...scopedConstraints, ...scopedTastes]
      .filter((fact) => fact.userId !== userId)
      .map((fact) => fact.id)
  );

  await report?.("fetching_weather");
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

  await report?.("grounding_places");
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
    privateMemoryFactIds,
  };
}

export function activeConstraintsView(
  scopedConstraints: Constraint[],
  viewerUserId?: string
): { id: string; text: string; status: string }[] {
  return scopedConstraints
    .filter((constraint) => !viewerUserId || constraint.userId === viewerUserId)
    .map((c) => ({ id: c.id, text: c.text, status: c.status }));
}

function redactFriendMemory(candidate: import("../../../shared/schemas.js").AiCandidate, privateTerms: string[], privateIds: Set<string>) {
  const redact = (value: string) => {
    let safe = value;
    for (const term of privateTerms.filter((item) => item.trim().length >= 3)) {
      safe = safe.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the group's preferences");
    }
    return safe;
  };
  return {
    ...candidate,
    title: redact(candidate.title),
    rationale: redact(candidate.rationale),
    beats: candidate.beats.map((beat) => ({
      ...beat,
      title: redact(beat.title),
      description: redact(beat.description),
    })),
    checkBeforeYouGo: candidate.checkBeforeYouGo.map(redact),
    citations: candidate.citations.filter((citation) => !privateIds.has(citation.factId)),
  };
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

export interface PlanEditDirective {
  request: string;
  mode: "restaurant" | "meal_time" | "budget" | "walking" | "general";
  originalCandidate: Candidate;
}

function mealBeatScore(beat: {
  category: string;
  title: string;
  description?: string;
  place?: { name?: string; kind: string } | null;
}): number {
  const identity = `${beat.title} ${beat.description ?? ""}`;
  const place = `${beat.place?.name ?? ""} ${beat.place?.kind ?? ""}`;
  const mealTerms = /food|meal|dinner|lunch|breakfast|restaurant|cafe|café|dining|bistro|tavern|bakery|kitchen|grill|steak|fish|seafood|shellfish|shack|petiscos|churrasc/i;
  let score = mealTerms.test(identity) ? 6 : 0;
  if (mealTerms.test(place)) score += 8;
  if (mealTerms.test(beat.category)) score += 1;
  if (/walk|stroll|arrival|museum|garden|park|viewpoint/i.test(identity) && score <= 1) score -= 2;
  return score;
}

export function findMealBeatIndex(beats: Array<Parameters<typeof mealBeatScore>[0]>): number {
  let bestIndex = -1;
  let bestScore = 0;
  beats.forEach((beat, index) => {
    const score = mealBeatScore(beat);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function replaceVenueName(value: string, from: string | null, to: string): string {
  if (!from) return value;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), to);
}

export function buildGroundedRestaurantSwap(original: Candidate): AiCandidate | null {
  const replacement = original.fallback;
  if (!replacement?.place) return null;
  const replacementIdentity = `${replacement.title} ${replacement.description} ${replacement.place.name} ${replacement.place.kind}`;
  if (!/food|meal|dinner|lunch|restaurant|cafe|café|dining|bistro|tavern|grill|fish|seafood|shellfish|petiscos|churrasc/i.test(replacementIdentity)) {
    return null;
  }
  const mealIndex = findMealBeatIndex(original.beats);
  if (mealIndex < 0) return null;
  const currentMeal = original.beats[mealIndex];
  const currentName = currentMeal.place?.name ?? null;
  if ((currentName ?? currentMeal.title).trim().toLowerCase() === replacement.place.name.trim().toLowerCase()) return null;

  const revisedBeat = {
    ...currentMeal,
    title: `Meal at ${replacement.place.name}`.slice(0, 120),
    description: `${replacement.description} ${replacement.place.factualNote}`.trim().slice(0, 400),
    place: replacement.place,
    directionsUrl: null,
  };
  return {
    title: `${original.title} — alternate restaurant`.slice(0, 120),
    rationale: `The same route and outdoor stops, with only the meal changed to ${replacement.place.name}, an already-grounded nearby fallback.`.slice(0, 600),
    category: original.category,
    indoor: original.indoor,
    beats: original.beats.map((beat, index) => index === mealIndex ? revisedBeat : { ...beat, directionsUrl: null }),
    walkingDistanceKm: original.walkingDistanceKm,
    walkingMinutes: original.walkingMinutes,
    estimatedCost: original.estimatedCost,
    checkBeforeYouGo: original.checkBeforeYouGo.map((item) => replaceVenueName(item, currentName, replacement.place!.name)),
    fallback: {
      title: `Original meal: ${currentName ?? currentMeal.title}`.slice(0, 140),
      description: "Return to the original meal without changing the rest of the route.",
      place: currentMeal.place ?? null,
    },
    photoSearchTerm: original.photoSearchTerm,
    heroImage: original.heroImage,
    routeMapsUrl: null,
    preparation: original.preparation,
    destinationAnchor: original.destinationAnchor,
    resolverVenueIds: [],
    citations: original.citations,
    constraintCompliance: original.constraintCompliance,
    travelEstimateKm: original.travelEstimateKm,
  };
}

function applyEditPreservation(candidate: AiCandidate, edit: PlanEditDirective): AiCandidate | null {
  const original = edit.originalCandidate;
  if (edit.mode === "restaurant" || edit.mode === "budget") {
    const detectedMealIndex = findMealBeatIndex(original.beats);
    const originalMealIndex = detectedMealIndex >= 0 ? detectedMealIndex : Math.min(1, original.beats.length - 1);
    const replacementMealIndex = findMealBeatIndex(candidate.beats);
    const replacementMeal = candidate.beats[replacementMealIndex >= 0 ? replacementMealIndex : originalMealIndex];
    if (originalMealIndex < 0 || !replacementMeal) return null;
    const originalMeal = original.beats[originalMealIndex];
    const replacementIdentity = replacementMeal.place?.name ?? replacementMeal.title;
    const originalIdentity = originalMeal.place?.name ?? originalMeal.title;
    if (replacementIdentity.trim().toLowerCase() === originalIdentity.trim().toLowerCase()) return null;
    const beats = original.beats.map((beat, index) => {
      if (index === originalMealIndex) return replacementMeal;
      const generatedMatch = candidate.beats.find(
        (item) => item.place?.name && item.place.name.toLowerCase() === beat.place?.name.toLowerCase()
      );
      return {
        ...beat,
        startTime: generatedMatch?.startTime ?? beat.startTime ?? null,
        travelMode: index === originalMealIndex + 1 ? generatedMatch?.travelMode ?? beat.travelMode ?? null : beat.travelMode ?? null,
        distanceFromPreviousKm: index === originalMealIndex + 1
          ? generatedMatch?.distanceFromPreviousKm ?? beat.distanceFromPreviousKm ?? null
          : beat.distanceFromPreviousKm ?? null,
        travelMinutes: index === originalMealIndex + 1
          ? generatedMatch?.travelMinutes ?? beat.travelMinutes ?? null
          : beat.travelMinutes ?? null,
      };
    });
    return {
      ...candidate,
      beats,
      heroImage: original.heroImage,
      photoSearchTerm: original.photoSearchTerm,
      preparation: original.preparation,
      destinationAnchor: original.destinationAnchor,
    };
  }
  if (edit.mode === "meal_time") {
    const originalMealIndex = findMealBeatIndex(original.beats);
    const generatedMealIndex = findMealBeatIndex(candidate.beats);
    const mealIndex = originalMealIndex >= 0 ? originalMealIndex : generatedMealIndex >= 0 ? generatedMealIndex : Math.min(1, candidate.beats.length - 1);
    const wantsDinner = /\bdinner|evening|night\b/i.test(edit.request);
    const wantsLunch = /\blunch|midday|noon\b/i.test(edit.request);
    const requestedSchedule = wantsDinner
      ? ["17:30", "19:30", "21:15"]
      : wantsLunch
        ? ["11:00", "12:30", "14:15"]
        : null;
    return {
      ...candidate,
      beats: candidate.beats.map((beat, index) => ({
        ...beat,
        place: original.beats[index]?.place ?? beat.place,
        startTime: requestedSchedule
          ? requestedSchedule[index === mealIndex ? 1 : index < mealIndex ? 0 : 2]
          : beat.startTime,
      })),
      heroImage: original.heroImage,
      photoSearchTerm: original.photoSearchTerm,
      destinationAnchor: original.destinationAnchor,
    };
  }
  return candidate;
}

export async function runGeneration(
  userId: string,
  spec: PlanSpec,
  batchIndex: number,
  edit?: PlanEditDirective,
  report?: ProgressReporter
): Promise<PipelineResult> {
  const context = await gatherPlanContext(userId, spec, report);
  const { selectedParticipants, scopedConstraints, scopedTastes, scopedHunches, weather, resolver, knownFacts } =
    context;

  const recentPlans = await lastSurfacedPlans(userId, 20);
  const recentSuggestions = recentPlans.slice(0, 12).map((plan) => ({
    title: plan.title,
    category: plan.category,
    placeNames: Array.from(new Set(plan.beats.map((beat) => beat.place?.name).filter((name): name is string => Boolean(name)))),
  }));

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
    recentSuggestions,
    seed: `${spec.id}:${batchIndex}`,
    edit: edit
      ? {
          request: edit.request,
          mode: edit.mode,
          originalPlan: {
            title: edit.originalCandidate.title,
            category: edit.originalCandidate.category,
            estimatedCost: edit.originalCandidate.estimatedCost,
            walkingMinutes: edit.originalCandidate.walkingMinutes,
            beats: edit.originalCandidate.beats.map((beat) => ({
              title: beat.title,
              category: beat.category,
              startTime: beat.startTime ?? null,
              durationMinutes: beat.durationMinutes ?? null,
              place: beat.place
                ? {
                    name: beat.place.name,
                    address: beat.place.address ?? null,
                    kind: beat.place.kind,
                    sourceUrl: beat.place.sourceUrl,
                    sourceLabel: beat.place.sourceLabel,
                    factualNote: beat.place.factualNote,
                  }
                : null,
            })),
          },
        }
      : undefined,
  };

  await report?.("composing_plan");
  const cachedRestaurantSwap = edit?.mode === "restaurant"
    ? buildGroundedRestaurantSwap(edit.originalCandidate)
    : null;
  const { mode, response, groundingSources } = cachedRestaurantSwap
    ? { mode: "gemini-grounded" as const, response: { candidates: [cachedRestaurantSwap] }, groundingSources: [] }
    : await generateCandidates(genCtx);
  const originalSources = edit
    ? [
        ...edit.originalCandidate.beats.flatMap((beat) => beat.place ? [{ url: beat.place.sourceUrl, title: beat.place.sourceLabel }] : []),
        ...(edit.originalCandidate.fallback?.place
          ? [{ url: edit.originalCandidate.fallback.place.sourceUrl, title: edit.originalCandidate.fallback.place.sourceLabel }]
          : []),
      ]
    : [];
  context.groundingSources = Array.from(
    new Map([...groundingSources, ...originalSources].map((source) => [source.url, source])).values()
  );
  const editSafeResponse = edit
    ? { ...response, candidates: response.candidates.map((candidate) => applyEditPreservation(candidate, edit)).filter((candidate): candidate is AiCandidate => Boolean(candidate)) }
    : response;

  const privateTerms = [
    ...selectedParticipants.filter((participant) => participant.userId !== userId).map((participant) => participant.name),
    ...scopedConstraints.filter((constraint) => constraint.userId !== userId).map((constraint) => constraint.text),
    ...scopedTastes.filter((taste) => taste.userId !== userId).map((taste) => taste.text),
  ];
  const privacySafeResponse = {
    ...response,
    candidates: editSafeResponse.candidates.map((candidate) =>
      redactFriendMemory(candidate, privateTerms, context.privateMemoryFactIds)
    ),
  };

  await report?.("validating_scoring");
  const { kept, rejected } = filterCandidates(privacySafeResponse.candidates, {
    activeConstraints: scopedConstraints.map((c) => ({ id: c.id, text: c.text })),
    knownFacts,
    resolverMode: resolver.mode,
    groundedSourceUrls: context.groundingSources.map((source) => source.url),
    radiusKm: spec.radiusKm,
    isTripScale: isTripScale(spec.scale),
  });

  const memories: ParticipantMemory[] = selectedParticipants.map((p) => ({
    participantId: p.id,
    tastes: scopedTastes.filter((t) => t.userId === p.userId && (t.participantId === null || t.participantId === p.id)),
    hunches: scopedHunches.filter((h) => h.userId === p.userId && (h.participantId === null || h.participantId === p.id)),
  }));

  const recentSummaries = recentPlans.map((p) => ({
    title: p.title,
    category: p.category,
    placeNames: p.beats.map((beat) => beat.place?.name).filter((name): name is string => Boolean(name)),
  }));
  const ranked: ScoredCandidate[] = scoreCandidates(kept, memories, weather, spec.radiusKm, recentSummaries);
  await report?.("enriching_saving");
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

  for (const candidate of [winner, ...alternates]) {
    const candidateSources = Array.from(new Map([
      ...candidate.beats.flatMap((beat) => beat.place
        ? [[beat.place.sourceUrl, { url: beat.place.sourceUrl, title: beat.place.sourceLabel }] as const]
        : []),
      ...(candidate.fallback?.place
        ? [[candidate.fallback.place.sourceUrl, {
            url: candidate.fallback.place.sourceUrl,
            title: candidate.fallback.place.sourceLabel,
          }] as const]
        : []),
    ]).values());
    await insertPlan({
      userId,
      planSpecId: spec.id,
      candidateId: candidate.id,
      status: "suggested",
      title: candidate.title,
      rationale: candidate.rationale,
      category: candidate.category,
      beats: candidate.beats,
      weather: context.weather,
      distanceKm: candidate.travelEstimateKm,
      placeProvenance: placeProvenanceView(context.resolver, candidateSources),
      activeConstraints: activeConstraintsView(context.scopedConstraints, userId),
      citations: candidate.citations,
      rejectionReason: null,
      locked: false,
    });
  }

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

// Pure helpers shared between the Worker's plan-specs router and the
// PlanGenerationWorkflow. Deliberately NOT imported from
// src/server/plans/routes.ts (which has the same logic): that file is an
// Express Router and does `const planSpecsRouter = Router()` at module
// scope, which would drag `express` itself into the Worker bundle for no
// reason. Keep these two copies in sync by hand if the response shape
// changes — same risk the Express build already has against any other
// duplicated view helper.
import { activeConstraintsView, placeProvenanceView, type PipelineResult } from "../server/plans/engine/pipeline.js";
import { MAX_GENERATIONS_PER_SPEC } from "../server/plans/limits.js";
import type { Candidate, PlanSpec } from "../shared/types.js";

export function planView(candidate: Candidate, context: PipelineResult["context"], viewerUserId: string) {
  return {
    candidate,
    weather: context.weather,
    placeProvenance: placeProvenanceView(context.resolver, context.groundingSources),
    activeConstraints: activeConstraintsView(context.scopedConstraints, viewerUserId),
  };
}

export function candidateGroundingSources(candidate: Candidate) {
  const sources = [
    ...candidate.beats.flatMap((beat) =>
      beat.place?.sourceUrl ? [{ url: beat.place.sourceUrl, title: beat.place.sourceLabel }] : []
    ),
    ...(candidate.fallback?.place?.sourceUrl
      ? [{ url: candidate.fallback.place.sourceUrl, title: candidate.fallback.place.sourceLabel }]
      : []),
  ];
  return Array.from(new Map(sources.map((source) => [source.url, source])).values());
}

export function pipelineResponse(spec: PlanSpec, result: PipelineResult, viewerUserId: string) {
  return {
    spec,
    aiMode: result.aiMode,
    deadEnd: result.deadEnd,
    deadEndReasons: result.deadEndReasons,
    winner: result.winner ? planView(result.winner, result.context, viewerUserId) : null,
    alternates: result.alternates.map((c) => planView(c, result.context, viewerUserId)),
    generationsUsed: spec.generationCount,
    generationsRemaining: Math.max(0, MAX_GENERATIONS_PER_SPEC - spec.generationCount),
  };
}

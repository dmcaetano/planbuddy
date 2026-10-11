// Pure view-shaping helpers shared by plans/routes.ts (Express/Render),
// moment/routes.ts (Express/Render), and the Worker's planSpecs.routes.ts.
// Extracted out of plans/routes.ts (2026-10, Cloudflare Worker port) so
// that neither moment/routes.ts nor the Worker needs to import an Express
// Router module (plans/routes.ts does `const planSpecsRouter = Router()`
// at module scope) just to reach these three functions.
import { activeConstraintsView, placeProvenanceView, type PipelineResult } from "./engine/pipeline.js";
import { MAX_GENERATIONS_PER_SPEC } from "./limits.js";
import type { Candidate, PlanSpec } from "../../shared/types.js";

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

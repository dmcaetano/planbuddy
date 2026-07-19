import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { planSpecCreateSchema, notThisSchema } from "../../shared/schemas.js";
import { createPlanSpec, getPlanSpec, incrementGenerationCount } from "./specs.repo.js";
import { getCandidate, listCandidatesForSpec } from "./candidates.repo.js";
import { insertPlan } from "./plans.repo.js";
import {
  activeConstraintsView,
  gatherPlanContext,
  placeProvenanceView,
  runGeneration,
  type PipelineResult,
} from "./engine/pipeline.js";
import { recordHunchEvidence } from "../memory/hunches.repo.js";
import { z } from "zod";
import type { Candidate } from "../../shared/types.js";

export const planSpecsRouter = Router();
planSpecsRouter.use(requireAuth);

const MAX_GENERATIONS = 2; // initial batch + one regeneration batch

function planView(candidate: Candidate, context: PipelineResult["context"]) {
  return {
    candidate,
    weather: context.weather,
    placeProvenance: placeProvenanceView(context.resolver),
    activeConstraints: activeConstraintsView(context.scopedConstraints),
  };
}

function pipelineResponse(spec: Awaited<ReturnType<typeof createPlanSpec>>, result: PipelineResult) {
  return {
    spec,
    aiMode: result.aiMode,
    deadEnd: result.deadEnd,
    deadEndReasons: result.deadEndReasons,
    winner: result.winner ? planView(result.winner, result.context) : null,
    alternates: result.alternates.map((c) => planView(c, result.context)),
    generationsUsed: spec.generationCount,
    generationsRemaining: Math.max(0, MAX_GENERATIONS - spec.generationCount),
  };
}

planSpecsRouter.post(
  "/",
  aiRateLimiter,
  validateBody(planSpecCreateSchema),
  asyncHandler(async (req, res) => {
    const spec = await createPlanSpec(req.user!.id, req.body);
    const result = await runGeneration(req.user!.id, spec, 0);
    const count = await incrementGenerationCount(spec.id);
    res.status(201).json(pipelineResponse({ ...spec, generationCount: count }, result));
  })
);

planSpecsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const spec = await getPlanSpec(req.user!.id, req.params.id);
    if (!spec) throw notFound();
    const candidates = await listCandidatesForSpec(spec.id);
    res.json({ spec, candidates });
  })
);

planSpecsRouter.post(
  "/:id/regenerate",
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const spec = await getPlanSpec(req.user!.id, req.params.id);
    if (!spec) throw notFound();
    if (spec.generationCount >= MAX_GENERATIONS) {
      res.json({
        spec,
        aiMode: "demo",
        deadEnd: false,
        deadEndReasons: [],
        winner: null,
        alternates: [],
        generationsUsed: spec.generationCount,
        generationsRemaining: 0,
        looseners: [
          "Widen the search radius",
          "Temporarily relax a soft taste preference",
          "Try a different date range",
        ],
      });
      return;
    }
    const result = await runGeneration(req.user!.id, spec, spec.generationCount);
    const count = await incrementGenerationCount(spec.id);
    res.json(pipelineResponse({ ...spec, generationCount: count }, result));
  })
);

const notThisBody = notThisSchema.extend({ candidateId: z.string().uuid() });

planSpecsRouter.post(
  "/:id/not-this",
  validateBody(notThisBody),
  asyncHandler(async (req, res) => {
    const spec = await getPlanSpec(req.user!.id, req.params.id);
    if (!spec) throw notFound();
    const candidate = await getCandidate(req.body.candidateId);
    if (!candidate || candidate.planSpecId !== spec.id) throw notFound();

    const context = await gatherPlanContext(req.user!.id, spec);
    await insertPlan({
      userId: req.user!.id,
      planSpecId: spec.id,
      candidateId: candidate.id,
      status: "rejected",
      title: candidate.title,
      rationale: candidate.rationale,
      category: candidate.category,
      beats: candidate.beats,
      weather: context.weather,
      distanceKm: candidate.travelEstimateKm,
      placeProvenance: placeProvenanceView(context.resolver),
      activeConstraints: activeConstraintsView(context.scopedConstraints),
      citations: candidate.citations,
      rejectionReason: req.body.reason,
      locked: false,
    });

    for (const participant of context.selectedParticipants) {
      await recordHunchEvidence(req.user!.id, {
        participantId: participant.id,
        text: `plans like "${candidate.title}" (${candidate.category})`,
        polarity: "avoid",
        planId: null,
        sessionId: null,
        note: `Not-this: ${req.body.reason}`,
      });
    }

    res.status(201).json({ ok: true });
  })
);

const lockBody = z.object({ candidateId: z.string().uuid() });

planSpecsRouter.post(
  "/:id/lock",
  validateBody(lockBody),
  asyncHandler(async (req, res) => {
    const spec = await getPlanSpec(req.user!.id, req.params.id);
    if (!spec) throw notFound();
    const candidate = await getCandidate(req.body.candidateId);
    if (!candidate || candidate.planSpecId !== spec.id) throw notFound();

    const context = await gatherPlanContext(req.user!.id, spec);
    const plan = await insertPlan({
      userId: req.user!.id,
      planSpecId: spec.id,
      candidateId: candidate.id,
      status: "locked",
      title: candidate.title,
      rationale: candidate.rationale,
      category: candidate.category,
      beats: candidate.beats,
      weather: context.weather,
      distanceKm: candidate.travelEstimateKm,
      placeProvenance: placeProvenanceView(context.resolver),
      activeConstraints: activeConstraintsView(context.scopedConstraints),
      citations: candidate.citations,
      rejectionReason: null,
      locked: true,
    });

    res.status(201).json({ plan });
  })
);

const tweakBody = planSpecCreateSchema.partial({ startDate: true, endDate: true, participantIds: true });

planSpecsRouter.post(
  "/:id/tweak",
  aiRateLimiter,
  validateBody(tweakBody),
  asyncHandler(async (req, res) => {
    const original = await getPlanSpec(req.user!.id, req.params.id);
    if (!original) throw notFound();

    const spec = await createPlanSpec(req.user!.id, {
      scale: req.body.scale ?? original.scale,
      startDate: req.body.startDate ?? original.startDate,
      endDate: req.body.endDate ?? original.endDate,
      radiusKm: req.body.radiusKm ?? original.radiusKm,
      moodContext: req.body.moodContext !== undefined ? req.body.moodContext : original.moodContext,
      participantIds: req.body.participantIds ?? original.participantIds,
      parentSpecId: original.id,
      version: original.version + 1,
    });

    const result = await runGeneration(req.user!.id, spec, 0);
    const count = await incrementGenerationCount(spec.id);
    res.status(201).json(pipelineResponse({ ...spec, generationCount: count }, result));
  })
);

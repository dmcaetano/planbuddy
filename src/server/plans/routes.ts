import { Router } from "express";
import { asyncHandler, HttpError, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { candidateReactionSchema, planSpecCreateSchema, notThisSchema } from "../../shared/schemas.js";
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
import { planningParticipantIdsAreAuthorized } from "../friends/repo.js";
import { applyCandidateReaction } from "./reactions.service.js";
import { enqueueGenerationJob } from "./jobs.js";
import { MAX_GENERATIONS_PER_SPEC } from "./limits.js";

export const planSpecsRouter = Router();
planSpecsRouter.use(requireAuth);

// Server-only extension of the shared client-facing schema — an optional
// idempotency key so a duplicate/retried POST reattaches to the same job
// instead of starting a second generation. Kept local rather than added to
// the shared schema since the client doesn't need to know about it to work.
const idempotencyKeySchema = z.string().trim().min(1).max(200).optional();
const planSpecCreateWithIdempotency = planSpecCreateSchema.extend({
  idempotencyKey: idempotencyKeySchema,
});

function planView(candidate: Candidate, context: PipelineResult["context"], viewerUserId: string) {
  return {
    candidate,
    weather: context.weather,
    placeProvenance: placeProvenanceView(context.resolver, context.groundingSources),
    activeConstraints: activeConstraintsView(context.scopedConstraints, viewerUserId),
  };
}

function candidateGroundingSources(candidate: Candidate) {
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

function pipelineResponse(spec: Awaited<ReturnType<typeof createPlanSpec>>, result: PipelineResult, viewerUserId: string) {
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

planSpecsRouter.post(
  "/",
  aiRateLimiter,
  validateBody(planSpecCreateWithIdempotency),
  asyncHandler(async (req, res) => {
    if (!(await planningParticipantIdsAreAuthorized(req.user!.id, req.body.participantIds))) {
      throw new HttpError(403, "One or more selected participants are not available to this account");
    }
    const { idempotencyKey, ...specInput } = req.body;
    const spec = await createPlanSpec(req.user!.id, specInput);
    const { jobId, existing } = await enqueueGenerationJob({
      userId: req.user!.id,
      operation: "create",
      idempotencyKey,
      requestPayload: { specId: spec.id },
      execute: async (report) => {
        const result = await runGeneration(req.user!.id, spec, 0, undefined, report);
        const count = await incrementGenerationCount(spec.id);
        return pipelineResponse({ ...spec, generationCount: count }, result, req.user!.id);
      },
    });
    res.status(202).json({ jobId, existing });
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
    const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : null;

    // No generation to run once the cap is hit — still routed through the
    // job system (a job that completes synchronously) so the client always
    // polls the same GET /plan-jobs/:id contract regardless of outcome.
    const { jobId, existing } = await enqueueGenerationJob({
      userId: req.user!.id,
      operation: "regenerate",
      idempotencyKey,
      requestPayload: { specId: spec.id },
      execute: async (report) => {
        if (spec.generationCount >= MAX_GENERATIONS_PER_SPEC) {
          return {
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
          };
        }
        const result = await runGeneration(req.user!.id, spec, spec.generationCount, undefined, report);
        const count = await incrementGenerationCount(spec.id);
        return pipelineResponse({ ...spec, generationCount: count }, result, req.user!.id);
      },
    });
    res.status(202).json({ jobId, existing });
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

    await applyCandidateReaction(req.user!.id, candidate, "dislike", { learnDislike: false });
    const context = await gatherPlanContext(req.user!.id, spec);
    const rejectedPlan = await insertPlan({
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
      placeProvenance: placeProvenanceView(context.resolver, candidateGroundingSources(candidate)),
      activeConstraints: activeConstraintsView(context.scopedConstraints, req.user!.id),
      citations: candidate.citations,
      rejectionReason: req.body.reason,
      locked: false,
    });

    const owner = context.selectedParticipants.find(
      (participant) => participant.userId === req.user!.id && participant.isOwner
    );
    await recordHunchEvidence(req.user!.id, {
      participantId: owner?.id ?? null,
      text: `Plans in the ${candidate.category} style`,
      polarity: "avoid",
      planId: rejectedPlan.id,
      sessionId: null,
      note: `Dislike: ${req.body.reason}`,
    });

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
    if (candidate.rejected) {
      throw new HttpError(409, "This suggestion did not pass PlanBuddy's safety checks");
    }

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
      placeProvenance: placeProvenanceView(context.resolver, candidateGroundingSources(candidate)),
      activeConstraints: activeConstraintsView(context.scopedConstraints, req.user!.id),
      citations: candidate.citations,
      rejectionReason: null,
      locked: true,
    });

    res.status(201).json({ plan });
  })
);

const tweakBody = planSpecCreateSchema.partial().extend({ idempotencyKey: idempotencyKeySchema });

planSpecsRouter.post(
  "/:id/tweak",
  aiRateLimiter,
  validateBody(tweakBody),
  asyncHandler(async (req, res) => {
    const original = await getPlanSpec(req.user!.id, req.params.id);
    if (!original) throw notFound();

    const participantIds = req.body.participantIds ?? original.participantIds;
    if (!(await planningParticipantIdsAreAuthorized(req.user!.id, participantIds))) {
      throw new HttpError(403, "One or more selected participants are no longer available");
    }

    const spec = await createPlanSpec(req.user!.id, {
      scale: req.body.scale ?? original.scale,
      startDate: req.body.startDate ?? original.startDate,
      endDate: req.body.endDate ?? original.endDate,
      radiusKm: req.body.radiusKm ?? original.radiusKm,
      moodContext: req.body.moodContext !== undefined ? req.body.moodContext : original.moodContext,
      participantIds,
      parentSpecId: original.id,
      version: original.version + 1,
    });

    const { jobId, existing } = await enqueueGenerationJob({
      userId: req.user!.id,
      operation: "tweak",
      idempotencyKey: req.body.idempotencyKey,
      requestPayload: { specId: spec.id, parentSpecId: original.id },
      execute: async (report) => {
        const result = await runGeneration(req.user!.id, spec, 0, undefined, report);
        const count = await incrementGenerationCount(spec.id);
        return pipelineResponse({ ...spec, generationCount: count }, result, req.user!.id);
      },
    });
    res.status(202).json({ jobId, existing });
  })
);

planSpecsRouter.post(
  "/:id/react",
  aiRateLimiter,
  validateBody(candidateReactionSchema),
  asyncHandler(async (req, res) => {
    const spec = await getPlanSpec(req.user!.id, req.params.id);
    if (!spec) throw notFound();
    const candidate = await getCandidate(req.body.candidateId);
    if (!candidate || candidate.planSpecId !== spec.id) throw notFound();
    const reaction = await applyCandidateReaction(req.user!.id, candidate, req.body.reaction);
    res.json({ reaction, learned: reaction.reaction === "love" ? {
      summary: reaction.featureSummary,
      features: reaction.features,
    } : null });
  })
);

import { Hono } from "hono";
import { z } from "zod";
import { candidateReactionSchema, planSpecCreateSchema, notThisSchema } from "../shared/schemas.js";
import { createPlanSpec, getPlanSpec } from "../server/plans/specs.repo.js";
import { getCandidate, listCandidatesForSpec } from "../server/plans/candidates.repo.js";
import { insertPlan } from "../server/plans/plans.repo.js";
import { activeConstraintsView, gatherPlanContext, placeProvenanceView } from "../server/plans/engine/pipeline.js";
import { recordHunchEvidence } from "../server/memory/hunches.repo.js";
import { planningParticipantIdsAreAuthorized } from "../server/friends/repo.js";
import { applyCandidateReaction } from "../server/plans/reactions.service.js";
import { enqueueJobRow } from "../server/plans/jobs.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";
import { aiRateLimiter } from "./rateLimit.js";
import { candidateGroundingSources } from "./planSpecs.shared.js";
import type { WorkerBindings } from "./bindings.js";

const idempotencyKeySchema = z.string().trim().min(1).max(200).optional();
const planSpecCreateWithIdempotency = planSpecCreateSchema.extend({ idempotencyKey: idempotencyKeySchema });
const notThisBody = notThisSchema.extend({ candidateId: z.string().uuid() });
const lockBody = z.object({ candidateId: z.string().uuid() });
const tweakBody = planSpecCreateSchema.partial().extend({ idempotencyKey: idempotencyKeySchema });

export const planSpecsRouter = new Hono<{ Bindings: WorkerBindings }>();
planSpecsRouter.use("*", requireAuth);

planSpecsRouter.post("/", aiRateLimiter, async (c) => {
  const body = await parseBody(c, planSpecCreateWithIdempotency);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  if (!(await planningParticipantIdsAreAuthorized(userId, body.participantIds))) {
    return c.json({ error: "One or more selected participants are not available to this account" }, 403);
  }
  const { idempotencyKey, ...specInput } = body;
  const spec = await createPlanSpec(userId, specInput);
  const { jobId, existing } = await enqueueJobRow({
    userId,
    operation: "create",
    idempotencyKey,
    requestPayload: { specId: spec.id },
  });
  if (!existing) {
    await c.env.PLAN_GENERATION.create({
      id: jobId,
      params: { jobId, userId, specId: spec.id, attempt: 0, capCheck: false },
    });
  }
  return c.json({ jobId, existing }, 202);
});

planSpecsRouter.get("/:id", async (c) => {
  const userId = c.get("user")!.id;
  const spec = await getPlanSpec(userId, c.req.param("id"));
  if (!spec) return notFoundResponse(c);
  const candidates = await listCandidatesForSpec(spec.id);
  return c.json({ spec, candidates });
});

planSpecsRouter.post("/:id/regenerate", aiRateLimiter, async (c) => {
  const userId = c.get("user")!.id;
  const spec = await getPlanSpec(userId, c.req.param("id"));
  if (!spec) return notFoundResponse(c);
  const rawBody = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const idempotencyKey = typeof rawBody?.idempotencyKey === "string" ? rawBody.idempotencyKey : null;

  const { jobId, existing } = await enqueueJobRow({
    userId,
    operation: "regenerate",
    idempotencyKey,
    requestPayload: { specId: spec.id },
  });
  if (!existing) {
    await c.env.PLAN_GENERATION.create({
      id: jobId,
      params: { jobId, userId, specId: spec.id, attempt: spec.generationCount, capCheck: true },
    });
  }
  return c.json({ jobId, existing }, 202);
});

planSpecsRouter.post("/:id/not-this", async (c) => {
  const body = await parseBody(c, notThisBody);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const spec = await getPlanSpec(userId, c.req.param("id"));
  if (!spec) return notFoundResponse(c);
  const candidate = await getCandidate(body.candidateId);
  if (!candidate || candidate.planSpecId !== spec.id) return notFoundResponse(c);

  await applyCandidateReaction(userId, candidate, "dislike", { learnDislike: false });
  const context = await gatherPlanContext(userId, spec);
  const rejectedPlan = await insertPlan({
    userId,
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
    activeConstraints: activeConstraintsView(context.scopedConstraints, userId),
    citations: candidate.citations,
    rejectionReason: body.reason,
    locked: false,
  });

  const owner = context.selectedParticipants.find((p) => p.userId === userId && p.isOwner);
  await recordHunchEvidence(userId, {
    participantId: owner?.id ?? null,
    text: `Plans in the ${candidate.category} style`,
    polarity: "avoid",
    planId: rejectedPlan.id,
    sessionId: null,
    note: `Dislike: ${body.reason}`,
  });

  return c.json({ ok: true }, 201);
});

planSpecsRouter.post("/:id/lock", async (c) => {
  const body = await parseBody(c, lockBody);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const spec = await getPlanSpec(userId, c.req.param("id"));
  if (!spec) return notFoundResponse(c);
  const candidate = await getCandidate(body.candidateId);
  if (!candidate || candidate.planSpecId !== spec.id) return notFoundResponse(c);
  if (candidate.rejected) {
    return c.json({ error: "This suggestion did not pass PlanBuddy's safety checks" }, 409);
  }

  const context = await gatherPlanContext(userId, spec);
  const plan = await insertPlan({
    userId,
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
    activeConstraints: activeConstraintsView(context.scopedConstraints, userId),
    citations: candidate.citations,
    rejectionReason: null,
    locked: true,
  });

  return c.json({ plan }, 201);
});

planSpecsRouter.post("/:id/tweak", aiRateLimiter, async (c) => {
  const body = await parseBody(c, tweakBody);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const original = await getPlanSpec(userId, c.req.param("id"));
  if (!original) return notFoundResponse(c);

  const participantIds = body.participantIds ?? original.participantIds;
  if (!(await planningParticipantIdsAreAuthorized(userId, participantIds))) {
    return c.json({ error: "One or more selected participants are no longer available" }, 403);
  }

  const spec = await createPlanSpec(userId, {
    scale: body.scale ?? original.scale,
    startDate: body.startDate ?? original.startDate,
    endDate: body.endDate ?? original.endDate,
    radiusKm: body.radiusKm ?? original.radiusKm,
    moodContext: body.moodContext !== undefined ? body.moodContext : original.moodContext,
    participantIds,
    parentSpecId: original.id,
    version: original.version + 1,
  });

  const { jobId, existing } = await enqueueJobRow({
    userId,
    operation: "tweak",
    idempotencyKey: body.idempotencyKey,
    requestPayload: { specId: spec.id, parentSpecId: original.id },
  });
  if (!existing) {
    await c.env.PLAN_GENERATION.create({
      id: jobId,
      params: { jobId, userId, specId: spec.id, attempt: 0, capCheck: false },
    });
  }
  return c.json({ jobId, existing }, 202);
});

planSpecsRouter.post("/:id/react", aiRateLimiter, async (c) => {
  const body = await parseBody(c, candidateReactionSchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const spec = await getPlanSpec(userId, c.req.param("id"));
  if (!spec) return notFoundResponse(c);
  const candidate = await getCandidate(body.candidateId);
  if (!candidate || candidate.planSpecId !== spec.id) return notFoundResponse(c);
  const reaction = await applyCandidateReaction(userId, candidate, body.reaction);
  return c.json({
    reaction,
    learned: reaction.reaction === "love" ? { summary: reaction.featureSummary, features: reaction.features } : null,
  });
});

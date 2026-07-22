import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { asyncHandler, HttpError, notFound, validateBody } from "../http.js";
import { planChatActionCreateSchema } from "../../shared/schemas.js";
import type { Candidate } from "../../shared/types.js";
import { getCandidate } from "./candidates.repo.js";
import { createPlanSpec, getPlanSpec, incrementGenerationCount } from "./specs.repo.js";
import { MAX_GENERATIONS_PER_SPEC } from "./limits.js";
import {
  activeConstraintsView,
  gatherPlanContext,
  placeProvenanceView,
  runGeneration,
  type PipelineResult,
} from "./engine/pipeline.js";
import { planActionInterpret } from "../ai/index.js";
import { addPlanChatMessage, listPlanChatMessages } from "./plan-chat.repo.js";
import { applyCandidateReaction } from "./reactions.service.js";
import { insertPlan } from "./plans.repo.js";
import { buildPublicSnapshot, createPlanShare } from "../shares/repo.js";
import { createFriendInvite, planningParticipantIdsAreAuthorized } from "../friends/repo.js";
import { enqueueGenerationJob, getActiveJobForUser } from "./jobs.js";

export const planChatRouter = Router();
planChatRouter.use(requireAuth);

function candidateSources(candidate: Candidate) {
  return Array.from(new Map(candidate.beats.flatMap((beat) =>
    beat.place ? [[beat.place.sourceUrl, { url: beat.place.sourceUrl, title: beat.place.sourceLabel }] as const] : []
  )).values());
}

function planView(candidate: Candidate, context: PipelineResult["context"], viewerUserId: string) {
  return {
    candidate,
    weather: context.weather,
    placeProvenance: placeProvenanceView(context.resolver, context.groundingSources),
    activeConstraints: activeConstraintsView(context.scopedConstraints, viewerUserId),
  };
}

function revisionResponse(spec: Awaited<ReturnType<typeof createPlanSpec>>, result: PipelineResult, viewerUserId: string) {
  return {
    spec,
    aiMode: result.aiMode,
    deadEnd: result.deadEnd,
    deadEndReasons: result.deadEndReasons,
    winner: result.winner ? planView(result.winner, result.context, viewerUserId) : null,
    alternates: [],
    generationsUsed: spec.generationCount,
    generationsRemaining: Math.max(0, MAX_GENERATIONS_PER_SPEC - spec.generationCount),
  };
}

planChatRouter.get(
  "/:id/chat",
  asyncHandler(async (req, res) => {
    if (!(await getPlanSpec(req.user!.id, req.params.id))) throw notFound();
    res.json({ messages: await listPlanChatMessages(req.user!.id, req.params.id) });
  })
);

planChatRouter.post(
  "/:id/chat-action",
  aiRateLimiter,
  validateBody(planChatActionCreateSchema),
  asyncHandler(async (req, res) => {
    const threadSpec = await getPlanSpec(req.user!.id, req.params.id);
    if (!threadSpec) throw notFound();
    const candidate = await getCandidate(req.body.candidateId);
    if (!candidate) throw notFound();
    const currentSpec = await getPlanSpec(req.user!.id, candidate.planSpecId);
    if (!currentSpec) throw notFound();

    const userMessage = await addPlanChatMessage(req.user!.id, threadSpec.id, candidate.id, "user", req.body.message);
    const interpreted = await planActionInterpret(req.body.message, candidate);
    const action = interpreted.response;
    let reply = action.reply;
    const revision = null;
    let learned = null;
    let plan = null;
    let share = null;
    let invite = null;
    let jobId: string | null = null;
    let jobSpecId: string | null = null;
    let jobKind: "edit" | "regenerate" | null = null;
    const activeJob = await getActiveJobForUser(req.user!.id);

    if (action.action === "react" && action.reaction) {
      const saved = await applyCandidateReaction(req.user!.id, candidate, action.reaction);
      learned = saved.reaction === "love" ? { summary: saved.featureSummary, features: saved.features } : null;
      reply = saved.reaction === "love" && saved.featureSummary
        ? `Loved. I learned: ${saved.featureSummary}`
        : `${saved.reaction === "dislike" ? "Disliked" : "Liked"}. I'll use that signal next time.`;
    } else if (action.action === "lock") {
      const context = await gatherPlanContext(req.user!.id, currentSpec);
      plan = await insertPlan({
        userId: req.user!.id,
        planSpecId: currentSpec.id,
        candidateId: candidate.id,
        status: "locked",
        title: candidate.title,
        rationale: candidate.rationale,
        category: candidate.category,
        beats: candidate.beats,
        weather: context.weather,
        distanceKm: candidate.travelEstimateKm,
        placeProvenance: placeProvenanceView(context.resolver, candidateSources(candidate)),
        activeConstraints: activeConstraintsView(context.scopedConstraints, req.user!.id),
        citations: candidate.citations,
        rejectionReason: null,
        locked: true,
      });
      reply = "Locked. The plan is now saved in History.";
    } else if (action.action === "share") {
      const context = await gatherPlanContext(req.user!.id, currentSpec);
      const snapshot = buildPublicSnapshot(
        currentSpec,
        candidate,
        context.weather,
        placeProvenanceView(context.resolver, candidateSources(candidate)),
        [...context.selectedParticipants.map((participant) => participant.name), ...context.scopedConstraints.map((constraint) => constraint.text)]
      );
      share = await createPlanShare(req.user!.id, candidate.id, snapshot);
      reply = "Your private plan link is ready. It includes the itinerary, not your memory or constraints.";
    } else if (action.action === "invite_friend") {
      invite = await createFriendInvite(req.user!.id);
      reply = "Your one-time friend invite is ready. Once accepted, you can select them under Who's in.";
    } else if ((action.action === "show_another" || action.action === "edit") && activeJob) {
      // Do not create a child spec while another job owns the one-active-job
      // slot. Returning the existing job keeps the dock honest and prevents
      // orphaned revisions that could never be generated.
      jobId = activeJob.jobId;
      reply = "I’m already working on your other plan change. I’ll keep it going while you browse.";
    } else if (action.action === "show_another") {
      if (currentSpec.generationCount >= MAX_GENERATIONS_PER_SPEC) {
        reply = "This version has used its fresh alternatives. Ask me for a specific change and I'll build a reversible revision instead.";
      } else {
        const queued = await enqueueGenerationJob({
          userId: req.user!.id,
          operation: "regenerate",
          requestPayload: { specId: currentSpec.id, candidateId: candidate.id, action: "show_another" },
          execute: async (report) => {
            const generated = await runGeneration(req.user!.id, currentSpec, currentSpec.generationCount, undefined, report);
            const count = await incrementGenerationCount(currentSpec.id);
            const next = revisionResponse({ ...currentSpec, generationCount: count }, generated, req.user!.id);
            await addPlanChatMessage(
              req.user!.id,
              threadSpec.id,
              candidate.id,
              "assistant",
              generated.winner ? "I found another grounded option. Your previous version is still available." : "I couldn't find another option that cleared every constraint.",
              { action: "show_another", completed: true }
            );
            return next;
          },
        });
        jobId = queued.jobId;
        jobSpecId = currentSpec.id;
        jobKind = "regenerate";
        reply = "I’m looking for another grounded option in the background. You can keep browsing while I work.";
      }
    } else if (action.action === "edit") {
      if (!(await planningParticipantIdsAreAuthorized(req.user!.id, currentSpec.participantIds))) {
        throw new HttpError(403, "A selected friend is no longer available for planning");
      }
      const child = await createPlanSpec(req.user!.id, {
        scale: currentSpec.scale,
        startDate: currentSpec.startDate,
        endDate: currentSpec.endDate,
        radiusKm: currentSpec.radiusKm,
        moodContext: action.instruction,
        participantIds: currentSpec.participantIds,
        parentSpecId: currentSpec.id,
        version: currentSpec.version + 1,
      });
      const queued = await enqueueGenerationJob({
        userId: req.user!.id,
        operation: "tweak",
        requestPayload: { specId: child.id, parentSpecId: currentSpec.id, candidateId: candidate.id, action: "edit" },
        execute: async (report) => {
          const generated = await runGeneration(req.user!.id, child, 0, {
            request: action.instruction,
            mode: action.editMode ?? "general",
            originalCandidate: candidate,
          }, report);
          const count = await incrementGenerationCount(child.id);
          const next = revisionResponse({ ...child, generationCount: count }, generated, req.user!.id);
          const scopeCopy = action.editMode === "restaurant" || action.editMode === "budget"
            ? "I changed the meal stop and kept the two other stops."
            : action.editMode === "meal_time"
              ? "I reorganized the timing around the new meal time and kept the existing venues where viable."
              : "I made the smallest grounded revision I could.";
          await addPlanChatMessage(
            req.user!.id,
            threadSpec.id,
            candidate.id,
            "assistant",
            generated.winner ? `${scopeCopy} The original remains one tap away.` : "I couldn't make that change without breaking a constraint or the route, so I left your plan untouched.",
            { action: "edit", editMode: action.editMode ?? null, completed: true }
          );
          return next;
        },
      });
      jobId = queued.jobId;
      jobSpecId = child.id;
      jobKind = "edit";
      reply = "I’m making that revision in the background. Your current plan stays right here while I work.";
    }

    const assistantMessage = await addPlanChatMessage(
      req.user!.id,
      threadSpec.id,
      candidate.id,
      "assistant",
      reply,
      { action: action.action, editMode: action.editMode ?? null, reaction: action.reaction ?? null }
    );
    res.status(jobId ? 202 : 201).json({
      userMessage,
      assistantMessage,
      action,
      revision,
      learned,
      plan,
      share,
      invite,
      aiMode: interpreted.mode,
      jobId,
      jobSpecId,
      jobKind,
    });
  })
);

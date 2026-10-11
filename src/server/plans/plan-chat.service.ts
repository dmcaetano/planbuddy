// Pure business logic for the in-plan "Edit this plan with Buddy"
// composer, split out of plan-chat.routes.ts (2026-10, Cloudflare Worker
// port — same reason as moment/resolve.ts and chat/service.ts: that file
// did `import { Router } from "express"` and built its router at module
// scope, which crashes a Worker merely by being imported). Nothing here
// imports express.
import { HttpError } from "../http.js";
import type { Candidate } from "../../shared/types.js";
import { getCandidate } from "./candidates.repo.js";
import { createPlanSpec, getPlanSpec, incrementGenerationCount } from "./specs.repo.js";
import { MAX_GENERATIONS_PER_SPEC } from "./limits.js";
import { activeConstraintsView, gatherPlanContext, placeProvenanceView, runGeneration, type PipelineResult } from "./engine/pipeline.js";
import { planActionInterpret } from "../ai/index.js";
import { addPlanChatMessage, listPlanChatMessages } from "./plan-chat.repo.js";
import type { PlanChatMessage } from "../../shared/types.js";
import { applyCandidateReaction } from "./reactions.service.js";
import { insertPlan } from "./plans.repo.js";
import { buildPublicSnapshot, createPlanShare } from "../shares/repo.js";
import { createFriendInvite, planningParticipantIdsAreAuthorized } from "../friends/repo.js";
import { answerAsApp, type AppActionResult } from "../chat/appAssistant.js";
import { enqueueGenerationJob, enqueueJobRow, getActiveJobForUser } from "./jobs.js";

function candidateSources(candidate: Candidate) {
  return Array.from(
    new Map(
      candidate.beats.flatMap((beat) =>
        beat.place ? [[beat.place.sourceUrl, { url: beat.place.sourceUrl, title: beat.place.sourceLabel }] as const] : []
      )
    ).values()
  );
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

export async function getPlanChatThread(userId: string, planSpecId: string): Promise<{ messages: PlanChatMessage[] }> {
  if (!(await getPlanSpec(userId, planSpecId))) throw new HttpError(404, "Not found");
  return { messages: await listPlanChatMessages(userId, planSpecId) };
}

/**
 * Cloudflare Worker hook, same pattern as moment/resolve.ts's JobDispatch:
 * when provided, "show_another"/"edit" start a job by calling this
 * instead of the Node-only enqueueGenerationJob's detached executor —
 * starting the SAME PlanGenerationWorkflow instance plan-specs/moment use,
 * now carrying an optional `edit` directive the Workflow's generate step
 * resolves back into a full PlanEditDirective via getCandidate().
 */
export type PlanChatJobDispatch = (job: {
  jobId: string;
  specId: string;
  attempt: number;
  edit?: { request: string; mode: "restaurant" | "meal_time" | "budget" | "walking" | "general"; originalCandidateId: string };
  planChatFollowUp: {
    threadSpecId: string;
    candidateId: string;
    kind: "show_another" | "edit";
    editMode?: "restaurant" | "meal_time" | "budget" | "walking" | "general";
  };
}) => Promise<void>;

export interface PlanChatActionResult {
  userMessage: PlanChatMessage;
  assistantMessage: PlanChatMessage;
  action: unknown;
  revision: null;
  learned: { summary: string | null; features: string[] } | null;
  plan: unknown;
  share: unknown;
  invite: unknown;
  aiMode: string;
  jobId: string | null;
  jobSpecId: string | null;
  jobKind: "edit" | "regenerate" | null;
  applied: unknown[];
  user: unknown;
  planRequest: unknown;
}

export async function postPlanChatAction(
  userId: string,
  threadSpecId: string,
  body: { candidateId: string; message: string },
  dispatch?: PlanChatJobDispatch
): Promise<PlanChatActionResult> {
  const threadSpec = await getPlanSpec(userId, threadSpecId);
  if (!threadSpec) throw new HttpError(404, "Not found");
  const candidate = await getCandidate(body.candidateId);
  if (!candidate) throw new HttpError(404, "Not found");
  const currentSpec = await getPlanSpec(userId, candidate.planSpecId);
  if (!currentSpec) throw new HttpError(404, "Not found");

  const userMessage = await addPlanChatMessage(userId, threadSpec.id, candidate.id, "user", body.message);
  const interpreted = await planActionInterpret(body.message, candidate);
  const action = interpreted.response;
  let reply = action.reply;
  const revision = null;
  let learned: PlanChatActionResult["learned"] = null;
  let plan: unknown = null;
  let share: unknown = null;
  let invite: unknown = null;
  let jobId: string | null = null;
  let jobSpecId: string | null = null;
  let jobKind: "edit" | "regenerate" | null = null;
  let appResult: AppActionResult | null = null;
  const activeJob = await getActiveJobForUser(userId);

  if (action.action === "app") {
    const answered = await answerAsApp(userId, body.message, userMessage.id);
    reply = answered.reply;
    appResult = answered.result;
  } else if (action.action === "react" && action.reaction) {
    const saved = await applyCandidateReaction(userId, candidate, action.reaction);
    learned = saved.reaction === "love" ? { summary: saved.featureSummary, features: saved.features } : null;
    reply =
      saved.reaction === "love" && saved.featureSummary
        ? `Loved. I learned: ${saved.featureSummary}`
        : `${saved.reaction === "dislike" ? "Disliked" : "Liked"}. I'll use that signal next time.`;
  } else if (action.action === "lock") {
    const context = await gatherPlanContext(userId, currentSpec);
    plan = await insertPlan({
      userId,
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
      activeConstraints: activeConstraintsView(context.scopedConstraints, userId),
      citations: candidate.citations,
      rejectionReason: null,
      locked: true,
    });
    reply = "Locked. The plan is now saved in History.";
  } else if (action.action === "share") {
    const context = await gatherPlanContext(userId, currentSpec);
    const snapshot = buildPublicSnapshot(
      currentSpec,
      candidate,
      context.weather,
      placeProvenanceView(context.resolver, candidateSources(candidate)),
      [...context.selectedParticipants.map((participant) => participant.name), ...context.scopedConstraints.map((constraint) => constraint.text)]
    );
    share = await createPlanShare(userId, candidate.id, snapshot);
    reply = "Your private plan link is ready. It includes the itinerary, not your memory or constraints.";
  } else if (action.action === "invite_friend") {
    invite = await createFriendInvite(userId);
    reply = "Your one-time friend invite is ready. Once accepted, you can select them under Who's in.";
  } else if ((action.action === "show_another" || action.action === "edit") && activeJob) {
    jobId = activeJob.jobId;
    reply = "I’m already working on your other plan change. I’ll keep it going while you browse.";
  } else if (action.action === "show_another") {
    if (currentSpec.generationCount >= MAX_GENERATIONS_PER_SPEC) {
      reply = "This version has used its fresh alternatives. Ask me for a specific change and I'll build a reversible revision instead.";
    } else if (!dispatch) {
      const queued = await enqueueGenerationJob({
        userId,
        operation: "regenerate",
        requestPayload: { specId: currentSpec.id, candidateId: candidate.id, action: "show_another" },
        execute: async (report) => {
          const generated = await runGeneration(userId, currentSpec, currentSpec.generationCount, undefined, report);
          const count = await incrementGenerationCount(currentSpec.id);
          const next = revisionResponse({ ...currentSpec, generationCount: count }, generated, userId);
          await addPlanChatMessage(
            userId,
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
    } else {
      const { jobId: newJobId, existing } = await enqueueJobRow({
        userId,
        operation: "regenerate",
        requestPayload: { specId: currentSpec.id, candidateId: candidate.id, action: "show_another" },
      });
      if (!existing) {
        await dispatch({
          jobId: newJobId,
          specId: currentSpec.id,
          attempt: currentSpec.generationCount,
          planChatFollowUp: { threadSpecId: threadSpec.id, candidateId: candidate.id, kind: "show_another" },
        });
      }
      jobId = newJobId;
      jobSpecId = currentSpec.id;
      jobKind = "regenerate";
      reply = "I’m looking for another grounded option in the background. You can keep browsing while I work.";
    }
  } else if (action.action === "edit") {
    if (!(await planningParticipantIdsAreAuthorized(userId, currentSpec.participantIds))) {
      throw new HttpError(403, "A selected friend is no longer available for planning");
    }
    const child = await createPlanSpec(userId, {
      scale: currentSpec.scale,
      startDate: currentSpec.startDate,
      endDate: currentSpec.endDate,
      radiusKm: currentSpec.radiusKm,
      moodContext: action.instruction,
      participantIds: currentSpec.participantIds,
      parentSpecId: currentSpec.id,
      version: currentSpec.version + 1,
    });

    if (!dispatch) {
      const queued = await enqueueGenerationJob({
        userId,
        operation: "tweak",
        requestPayload: { specId: child.id, parentSpecId: currentSpec.id, candidateId: candidate.id, action: "edit" },
        execute: async (report) => {
          const generated = await runGeneration(
            userId,
            child,
            0,
            { request: action.instruction, mode: action.editMode ?? "general", originalCandidate: candidate },
            report
          );
          const count = await incrementGenerationCount(child.id);
          const next = revisionResponse({ ...child, generationCount: count }, generated, userId);
          const scopeCopy =
            action.editMode === "restaurant" || action.editMode === "budget"
              ? "I changed the meal stop and kept the two other stops."
              : action.editMode === "meal_time"
                ? "I reorganized the timing around the new meal time and kept the existing venues where viable."
                : "I made the smallest grounded revision I could.";
          await addPlanChatMessage(
            userId,
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
    } else {
      const { jobId: newJobId, existing } = await enqueueJobRow({
        userId,
        operation: "tweak",
        requestPayload: { specId: child.id, parentSpecId: currentSpec.id, candidateId: candidate.id, action: "edit" },
      });
      if (!existing) {
        await dispatch({
          jobId: newJobId,
          specId: child.id,
          attempt: 0,
          edit: { request: action.instruction, mode: action.editMode ?? "general", originalCandidateId: candidate.id },
          planChatFollowUp: {
            threadSpecId: threadSpec.id,
            candidateId: candidate.id,
            kind: "edit",
            editMode: action.editMode ?? "general",
          },
        });
      }
      jobId = newJobId;
    }
    jobSpecId = child.id;
    jobKind = "edit";
    reply = "I’m making that revision in the background. Your current plan stays right here while I work.";
  }

  const assistantMessage = await addPlanChatMessage(userId, threadSpec.id, candidate.id, "assistant", reply, {
    action: action.action,
    editMode: action.editMode ?? null,
    reaction: action.reaction ?? null,
  });

  return {
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
    applied: appResult?.applied ?? [],
    user: appResult?.user ?? null,
    planRequest: appResult?.planRequest ?? null,
  };
}

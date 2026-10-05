import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import {
  momentTimes,
  parseLocalDateTime,
  resolveMoment,
  scopeSwitchMoments,
  type MomentTimes,
} from "../../shared/moment.js";
import type {
  MomentInfo,
  MomentResponse,
  MomentStatus,
  ReasonParts,
} from "../../shared/momentTypes.js";
import { SCALE_RADIUS_KM, type Scale } from "../../shared/scale.js";
import type { Candidate, Constraint, Participant, PlanRecord, PlanSpec, WeatherSnapshot } from "../../shared/types.js";
import { listParticipants } from "../participants/repo.js";
import { listActiveConstraints } from "../memory/constraints.repo.js";
import { createPlanSpec, getPlanSpec, incrementGenerationCount, listSpecsForMoment } from "../plans/specs.repo.js";
import { getCandidate, insertCandidates } from "../plans/candidates.repo.js";
import { runGeneration } from "../plans/engine/pipeline.js";
import { findViolatedConstraint } from "../plans/engine/filter.js";
import { pipelineResponse } from "../plans/routes.js";
import { enqueueGenerationJob } from "../plans/jobs.js";
import { MAX_GENERATIONS_PER_SPEC } from "../plans/limits.js";
import { currentAiMode } from "../ai/index.js";
import { listLockedTripRanges, listTimeOff } from "../timeoff/repo.js";
import { composeNudge, selectNudgeRange } from "../timeoff/nudge.js";
import { citableTasteFor, ensureIdeas } from "../timeoff/tripIdeas.js";
import { computeInputsFingerprint } from "./fingerprint.js";
import { isRomanticGroup } from "./romantic.js";
import { buildMomentMood, toStoredTimes } from "./mood.js";
import { buildReasonLine, buildReasonParts } from "./reason.js";
import { firstBeatStarted, lastBeatEnded, retimeBeatsForMoment } from "./retime.js";
import {
  candidateToPayload,
  findActiveJob,
  findNewestMomentPlan,
  listLockedPlansCovering,
  repointPlan,
  updateSpecMomentTiming,
} from "./repo.js";

export const momentRouter = Router();
momentRouter.use(requireAuth);

const momentBodySchema = z
  .object({
    localDateTime: z.string().max(40).refine((value) => parseLocalDateTime(value) !== null, "Invalid local date-time"),
    kind: z.enum(["tonight", "day", "weekend"]).optional(),
  })
  .strict();

const UNAVAILABLE_WEATHER: WeatherSnapshot = {
  temperatureC: null,
  precipitationProbability: null,
  summary: "Weather unavailable",
  unavailable: true,
};

interface Base {
  userId: string;
  moment: MomentInfo;
  romantic: boolean;
  household: Participant[];
}

function respond(
  base: Base,
  status: MomentStatus,
  extra: Partial<Pick<MomentResponse, "plan" | "lockedPlanId" | "jobId" | "reasonParts">> = {}
): MomentResponse {
  const reasonParts = extra.reasonParts ?? null;
  return {
    moment: base.moment,
    status,
    reasonLine: reasonParts ? buildReasonLine(reasonParts) : null,
    reasonParts,
    romantic: base.romantic,
    plan: extra.plan ?? null,
    lockedPlanId: extra.lockedPlanId ?? null,
    jobId: extra.jobId ?? null,
    nudge: null,
    lead: "moment",
  };
}

/** The PipelineResponse shape the client already uses, built from stored rows (no pipeline run). */
function storedPlanResponse(spec: PlanSpec, candidate: Candidate, plan: PlanRecord) {
  return {
    spec,
    aiMode: currentAiMode(),
    deadEnd: false,
    deadEndReasons: [] as string[],
    winner: {
      candidate,
      weather: plan.weather ?? UNAVAILABLE_WEATHER,
      placeProvenance: plan.placeProvenance,
      activeConstraints: plan.activeConstraints,
    },
    alternates: [] as unknown[],
    generationsUsed: spec.generationCount,
    generationsRemaining: Math.max(0, MAX_GENERATIONS_PER_SPEC - spec.generationCount),
  };
}

function ceilingResponse(spec: PlanSpec) {
  return {
    spec,
    aiMode: "demo" as const,
    deadEnd: false,
    deadEndReasons: [] as string[],
    winner: null,
    alternates: [] as unknown[],
    generationsUsed: spec.generationCount,
    generationsRemaining: 0,
    looseners: ["Widen the search radius", "Temporarily relax a soft taste preference", "Try a different date range"],
  };
}

/** Reason parts to show for a stored spec; falls back to the moment, people and weather already held. */
function partsForSpec(spec: PlanSpec, base: Base, plan: PlanRecord | null): ReasonParts {
  if (spec.reasonParts) return spec.reasonParts;
  return buildReasonParts({
    momentLabel: base.moment.label,
    participants: base.household,
    romantic: base.romantic,
    taste: null,
    weather: plan?.weather ?? null,
  });
}

async function coveringLockedPlan(base: Base, localIso: string): Promise<{ plan: PlanRecord; spec: PlanSpec } | null> {
  const parsed = parseLocalDateTime(localIso)!;
  const plans = await listLockedPlansCovering(base.userId, base.moment.planDate);
  for (const plan of plans) {
    const sameSingleDayToday =
      base.moment.planDate === parsed.date && plan.eventStartDate === plan.eventEndDate && plan.eventStartDate === base.moment.planDate;
    if (sameSingleDayToday && lastBeatEnded(plan.beats, localIso)) continue;
    const spec = await getPlanSpec(base.userId, plan.planSpecId);
    if (spec) return { plan, spec };
  }
  return null;
}

async function tryReuse(
  base: Base,
  localIso: string,
  plan: PlanRecord,
  constraints: Constraint[],
  times: MomentTimes
): Promise<MomentResponse | null> {
  if (plan.status !== "suggested") return null;
  const candidate = await getCandidate(plan.candidateId);
  if (!candidate || candidate.rejected) return null;
  // Spec rule 10: the hard-constraint filter is applied again to a reused plan.
  if (findViolatedConstraint(candidate, constraints)) return null;
  const spec = await getPlanSpec(base.userId, plan.planSpecId);
  if (!spec) return null;

  const stale = base.moment.kind !== "weekend" && firstBeatStarted(plan.beats, base.moment.planDate, localIso);
  if (!stale) {
    return respond(base, "ready", {
      plan: storedPlanResponse(spec, candidate, plan),
      reasonParts: partsForSpec(spec, base, plan),
    });
  }

  // Spec rule 6: retime in place, same venues, one reversible revision, no new History row.
  const retimed = retimeBeatsForMoment(plan.beats, base.moment.kind, times);
  if (!retimed) return null;
  const child = await createPlanSpec(base.userId, {
    scale: spec.scale,
    startDate: spec.startDate,
    endDate: spec.endDate,
    radiusKm: spec.radiusKm,
    moodContext: buildMomentMood(base.moment, times, base.romantic),
    participantIds: spec.participantIds,
    parentSpecId: spec.id,
    version: spec.version + 1,
    generationCount: spec.generationCount,
    moment: {
      kind: base.moment.kind,
      key: base.moment.key,
      planDate: base.moment.planDate,
      inputsFingerprint: spec.inputsFingerprint ?? "",
      reasonParts: spec.reasonParts ?? null,
      times: toStoredTimes(times, base.romantic),
    },
  });
  const [saved] = await insertCandidates(child.id, [
    {
      payload: candidateToPayload(candidate, retimed.beats, retimed.reordered),
      scoreBreakdown: candidate.scoreBreakdown,
      rank: 1,
      rejected: false,
      rejectionReason: null,
    },
  ]);
  await repointPlan(base.userId, plan.id, saved.id, child.id, retimed.beats);
  const refreshed = { ...plan, beats: retimed.beats, candidateId: saved.id, planSpecId: child.id };
  return respond(base, "ready", {
    plan: storedPlanResponse(child, saved, refreshed),
    reasonParts: partsForSpec(child, base, refreshed),
  });
}

function momentScale(kind: MomentInfo["kind"]): Scale {
  return kind === "weekend" ? "weekend" : "day_off";
}

async function startGeneration(
  base: Base,
  fingerprint: string,
  times: MomentTimes
): Promise<MomentResponse> {
  const { userId, moment } = base;
  const active = await findActiveJob(userId);
  if (active) return respond(base, "generating", { jobId: active.jobId });

  const mood = buildMomentMood(moment, times, base.romantic);
  const stored = toStoredTimes(times, base.romantic);
  const [existing] = await listSpecsForMoment(userId, moment.key, fingerprint);

  if (existing) {
    // Same key and fingerprint: a new proposal under the same setup, counted against its ceiling.
    if (existing.generationCount >= MAX_GENERATIONS_PER_SPEC) {
      return respond(base, "ready", { plan: ceilingResponse(existing), reasonParts: partsForSpec(existing, base, null) });
    }
    await updateSpecMomentTiming(userId, existing.id, mood, stored);
    const spec = (await getPlanSpec(userId, existing.id)) ?? existing;
    const { jobId } = await enqueueGenerationJob({
      userId,
      operation: "regenerate",
      requestPayload: { specId: spec.id, momentKey: moment.key },
      execute: async (report) => {
        const result = await runGeneration(userId, spec, spec.generationCount, undefined, report);
        const count = await incrementGenerationCount(spec.id);
        const fresh = (await getPlanSpec(userId, spec.id)) ?? spec;
        return pipelineResponse({ ...fresh, generationCount: count }, result, userId);
      },
    });
    return respond(base, "generating", { jobId });
  }

  const spec = await createPlanSpec(userId, {
    scale: momentScale(moment.kind),
    startDate: moment.planDate,
    endDate: moment.planDate,
    radiusKm: SCALE_RADIUS_KM[momentScale(moment.kind)],
    moodContext: mood,
    participantIds: base.household.map((participant) => participant.id),
    moment: {
      kind: moment.kind,
      key: moment.key,
      planDate: moment.planDate,
      inputsFingerprint: fingerprint,
      times: stored,
    },
  });
  const { jobId } = await enqueueGenerationJob({
    userId,
    operation: "create",
    requestPayload: { specId: spec.id, momentKey: moment.key },
    execute: async (report) => {
      const result = await runGeneration(userId, spec, 0, undefined, report);
      const count = await incrementGenerationCount(spec.id);
      const fresh = (await getPlanSpec(userId, spec.id)) ?? spec;
      return pipelineResponse({ ...fresh, generationCount: count }, result, userId);
    },
  });
  return respond(base, "generating", { jobId });
}

async function resolveCore(
  userId: string,
  body: { localDateTime: string; kind?: MomentInfo["kind"] }
): Promise<MomentResponse> {
  const localIso = body.localDateTime;
  const moment = body.kind ? scopeSwitchMoments(localIso)[body.kind] : resolveMoment(localIso);
  const household = await listParticipants(userId);
  const base: Base = { userId, moment, romantic: isRomanticGroup(household, moment.kind), household };
  if (household.length === 0) return respond(base, "empty_household");

  const locked = await coveringLockedPlan(base, localIso);
  if (locked) {
    const candidate = await getCandidate(locked.plan.candidateId);
    if (candidate) {
      const sameMoment = locked.spec.momentKey === moment.key;
      return respond(base, "locked", {
        plan: storedPlanResponse(locked.spec, candidate, locked.plan),
        lockedPlanId: locked.plan.id,
        reasonParts: sameMoment ? partsForSpec(locked.spec, base, locked.plan) : null,
      });
    }
  }

  const constraints = await listActiveConstraints(userId);
  const fingerprint = computeInputsFingerprint(household, constraints);
  const times = momentTimes(moment.kind, moment.planDate, localIso);

  const newest = await findNewestMomentPlan(userId, moment.key, fingerprint);
  if (newest) {
    const reused = await tryReuse(base, localIso, newest, constraints, times);
    if (reused) return reused;
  }
  return startGeneration(base, fingerprint, times);
}

/**
 * The moment plus the trip nudge (spec rules 18-24). Precedence: a locked plan covering the moment, or a
 * `tonight`/`day` moment, leads with the nudge as the smaller card; a `weekend` moment is led by the nudge.
 * With no time-off rows nothing about time off is computed or returned.
 */
export async function resolveMomentForUser(
  userId: string,
  body: { localDateTime: string; kind?: MomentInfo["kind"] }
): Promise<MomentResponse> {
  const response = await resolveCore(userId, body);
  if (response.status === "empty_household") return response;
  const timeOff = await listTimeOff(userId);
  if (timeOff.length === 0) return response;
  const localDate = parseLocalDateTime(body.localDateTime)!.date;
  const range = selectNudgeRange(timeOff, localDate, await listLockedTripRanges(userId));
  if (!range) return response;
  const [ideas, taste] = await Promise.all([ensureIdeas(userId, range), citableTasteFor(userId, range)]);
  const nudge = composeNudge(range, taste, localDate, ideas);
  const lead = response.moment.kind === "weekend" && response.status !== "locked" ? "nudge" : "moment";
  return { ...response, nudge, lead };
}

momentRouter.post(
  "/",
  aiRateLimiter,
  validateBody(momentBodySchema),
  asyncHandler(async (req, res) => {
    res.json(await resolveMomentForUser(req.user!.id, req.body));
  })
);

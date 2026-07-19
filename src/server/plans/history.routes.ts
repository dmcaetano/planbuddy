import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { feedbackCreateSchema } from "../../shared/schemas.js";
import { getPlan, listPlans } from "./plans.repo.js";
import { getPlanSpec } from "./specs.repo.js";
import { insertFeedback, listFeedbackForPlan } from "./feedback.repo.js";
import { recordHunchEvidence } from "../memory/hunches.repo.js";
import { feedbackExtract } from "../ai/index.js";
import { getCandidate } from "./candidates.repo.js";
import { applyCandidateReaction } from "./reactions.service.js";
import { listParticipants } from "../participants/repo.js";
import type { Reaction } from "../../shared/types.js";
import { getCandidateReaction } from "./reactions.repo.js";

export const historyRouter = Router();
historyRouter.use(requireAuth);

historyRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const plans = await listPlans(req.user!.id);
    const todayStr = new Date().toISOString().slice(0, 10);
    const suggested = plans.filter((p) => p.status === "suggested");
    const upcoming = plans.filter((p) => p.status === "locked" && p.eventEndDate >= todayStr);
    const past = plans.filter((p) => p.status !== "suggested" && !(p.status === "locked" && p.eventEndDate >= todayStr));
    res.json({ suggested, upcoming, past });
  })
);

historyRouter.get(
  "/:planId",
  asyncHandler(async (req, res) => {
    const plan = await getPlan(req.user!.id, req.params.planId);
    if (!plan) throw notFound();
    const [feedback, reaction] = await Promise.all([
      listFeedbackForPlan(plan.id),
      getCandidateReaction(req.user!.id, plan.candidateId),
    ]);
    res.json({ plan, feedback, reaction });
  })
);

historyRouter.post(
  "/:planId/feedback",
  validateBody(feedbackCreateSchema),
  asyncHandler(async (req, res) => {
    const plan = await getPlan(req.user!.id, req.params.planId);
    if (!plan) throw notFound();
    const reaction: Reaction = req.body.reaction ?? (req.body.rating <= 2 ? "dislike" : req.body.rating >= 5 ? "love" : "like");
    const rating = req.body.rating ?? (reaction === "dislike" ? 1 : reaction === "love" ? 5 : 4);
    const candidate = await getCandidate(plan.candidateId);
    if (!candidate) throw notFound();
    const savedReaction = await applyCandidateReaction(req.user!.id, candidate, reaction, { learnDislike: false });
    const learned = reaction === "love"
      ? { summary: savedReaction.featureSummary, features: savedReaction.features }
      : null;
    const feedback = await insertFeedback(plan.id, rating, reaction, req.body.comment ?? null, learned);

    const { response } = await feedbackExtract(rating, req.body.comment ?? null);
    const ratingFallback =
      response.evidence.length === 0 && reaction === "like"
        ? [{ text: `Plans in the ${plan.category} style`, polarity: "love" as const }]
        : response.evidence.length === 0 && reaction === "dislike"
          ? [{ text: `Plans in the ${plan.category} style`, polarity: "avoid" as const }]
          : [];
    const evidenceItems = response.evidence.length > 0 ? response.evidence : ratingFallback;
    await getPlanSpec(req.user!.id, plan.planSpecId);
    const owner = (await listParticipants(req.user!.id)).find((participant) => participant.isOwner);
    for (const evidence of evidenceItems) {
      await recordHunchEvidence(req.user!.id, {
        participantId: owner?.id ?? null,
        text: evidence.text,
        polarity: evidence.polarity,
        planId: plan.id,
        sessionId: null,
        note: `${reaction}: ${req.body.comment ?? ""}`.trim(),
      });
    }

    res.status(201).json({ feedback, learned });
  })
);

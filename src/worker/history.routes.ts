import { Hono } from "hono";
import { feedbackCreateSchema } from "../shared/schemas.js";
import { getPlan, listPlans } from "../server/plans/plans.repo.js";
import { getPlanSpec } from "../server/plans/specs.repo.js";
import { insertFeedback, listFeedbackForPlan } from "../server/plans/feedback.repo.js";
import { recordHunchEvidence } from "../server/memory/hunches.repo.js";
import { feedbackExtract } from "../server/ai/index.js";
import { getCandidate } from "../server/plans/candidates.repo.js";
import { applyCandidateReaction } from "../server/plans/reactions.service.js";
import { listParticipants } from "../server/participants/repo.js";
import type { Reaction } from "../shared/types.js";
import { getCandidateReaction } from "../server/plans/reactions.repo.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";

export const historyRouter = new Hono();
historyRouter.use("*", requireAuth);

historyRouter.get("/", async (c) => {
  const plans = await listPlans(c.get("user")!.id);
  const todayStr = new Date().toISOString().slice(0, 10);
  const suggested = plans.filter((p) => p.status === "suggested");
  const upcoming = plans.filter((p) => p.status === "locked" && p.eventEndDate >= todayStr);
  const past = plans.filter((p) => p.status !== "suggested" && !(p.status === "locked" && p.eventEndDate >= todayStr));
  return c.json({ suggested, upcoming, past });
});

historyRouter.get("/:planId", async (c) => {
  const userId = c.get("user")!.id;
  const plan = await getPlan(userId, c.req.param("planId"));
  if (!plan) return notFoundResponse(c);
  const [feedback, reaction] = await Promise.all([
    listFeedbackForPlan(plan.id),
    getCandidateReaction(userId, plan.candidateId),
  ]);
  return c.json({ plan, feedback, reaction });
});

historyRouter.post("/:planId/feedback", async (c) => {
  const body = await parseBody(c, feedbackCreateSchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const plan = await getPlan(userId, c.req.param("planId"));
  if (!plan) return notFoundResponse(c);
  const reaction: Reaction = body.reaction ?? (body.rating <= 2 ? "dislike" : body.rating >= 5 ? "love" : "like");
  const rating = body.rating ?? (reaction === "dislike" ? 1 : reaction === "love" ? 5 : 4);
  const candidate = await getCandidate(plan.candidateId);
  if (!candidate) return notFoundResponse(c);
  const savedReaction = await applyCandidateReaction(userId, candidate, reaction, { learnDislike: false });
  const learned =
    reaction === "love" ? { summary: savedReaction.featureSummary, features: savedReaction.features } : null;
  const feedback = await insertFeedback(plan.id, rating, reaction, body.comment ?? null, learned);

  const { response } = await feedbackExtract(rating, body.comment ?? null);
  const ratingFallback =
    response.evidence.length === 0 && reaction === "like"
      ? [{ text: `Plans in the ${plan.category} style`, polarity: "love" as const }]
      : response.evidence.length === 0 && reaction === "dislike"
        ? [{ text: `Plans in the ${plan.category} style`, polarity: "avoid" as const }]
        : [];
  const evidenceItems = response.evidence.length > 0 ? response.evidence : ratingFallback;
  await getPlanSpec(userId, plan.planSpecId);
  const owner = (await listParticipants(userId)).find((participant) => participant.isOwner);
  for (const evidence of evidenceItems) {
    await recordHunchEvidence(userId, {
      participantId: owner?.id ?? null,
      text: evidence.text,
      polarity: evidence.polarity,
      planId: plan.id,
      sessionId: null,
      note: `${reaction}: ${body.comment ?? ""}`.trim(),
    });
  }

  return c.json({ feedback, learned }, 201);
});

import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { feedbackCreateSchema } from "../../shared/schemas.js";
import { getPlan, listPlans } from "./plans.repo.js";
import { getPlanSpec } from "./specs.repo.js";
import { insertFeedback, listFeedbackForPlan } from "./feedback.repo.js";
import { recordHunchEvidence } from "../memory/hunches.repo.js";
import { feedbackExtract } from "../ai/index.js";

export const historyRouter = Router();
historyRouter.use(requireAuth);

historyRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const plans = await listPlans(req.user!.id);
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming = plans.filter((p) => p.status === "locked" && p.eventEndDate >= todayStr);
    const past = plans.filter((p) => !(p.status === "locked" && p.eventEndDate >= todayStr));
    res.json({ upcoming, past });
  })
);

historyRouter.get(
  "/:planId",
  asyncHandler(async (req, res) => {
    const plan = await getPlan(req.user!.id, req.params.planId);
    if (!plan) throw notFound();
    const feedback = await listFeedbackForPlan(plan.id);
    res.json({ plan, feedback });
  })
);

historyRouter.post(
  "/:planId/feedback",
  validateBody(feedbackCreateSchema),
  asyncHandler(async (req, res) => {
    const plan = await getPlan(req.user!.id, req.params.planId);
    if (!plan) throw notFound();
    const feedback = await insertFeedback(plan.id, req.body.rating, req.body.comment ?? null);

    const { response } = await feedbackExtract(req.body.rating, req.body.comment ?? null);
    const spec = await getPlanSpec(req.user!.id, plan.planSpecId);
    const participantIds = spec?.participantIds ?? [];
    const targets: (string | null)[] = participantIds.length > 0 ? participantIds : [null];
    for (const evidence of response.evidence) {
      for (const participantId of targets) {
        await recordHunchEvidence(req.user!.id, {
          participantId,
          text: evidence.text,
          polarity: evidence.polarity,
          planId: plan.id,
          sessionId: null,
          note: `Feedback (${req.body.rating}/5): ${req.body.comment ?? ""}`.trim(),
        });
      }
    }

    res.status(201).json({ feedback });
  })
);

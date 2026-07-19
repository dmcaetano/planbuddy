import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { publicTokenRateLimiter } from "../rateLimit.js";
import { friendTokenSchema, shareCreateSchema } from "../../shared/schemas.js";
import { getCandidate } from "../plans/candidates.repo.js";
import { getPlanSpec } from "../plans/specs.repo.js";
import { gatherPlanContext, placeProvenanceView } from "../plans/engine/pipeline.js";
import { buildPublicSnapshot, createPlanShare, getPlanShare, revokePlanShare } from "./repo.js";

export const sharesRouter = Router();

sharesRouter.post(
  "/",
  requireAuth,
  validateBody(shareCreateSchema),
  asyncHandler(async (req, res) => {
    const candidate = await getCandidate(req.body.candidateId);
    if (!candidate) throw notFound();
    const spec = await getPlanSpec(req.user!.id, candidate.planSpecId);
    if (!spec) throw notFound();
    const context = await gatherPlanContext(req.user!.id, spec);
    const privateTerms = [
      ...context.selectedParticipants.map((participant) => participant.name),
      ...context.scopedConstraints.map((constraint) => constraint.text),
    ];
    const snapshot = buildPublicSnapshot(
      spec,
      candidate,
      context.weather,
      placeProvenanceView(context.resolver, context.groundingSources),
      privateTerms
    );
    const share = await createPlanShare(req.user!.id, candidate.id, snapshot);
    res.status(201).json({ share });
  })
);

sharesRouter.get(
  "/:token",
  publicTokenRateLimiter,
  asyncHandler(async (req, res) => {
    const token = friendTokenSchema.safeParse(req.params.token);
    if (!token.success) throw notFound();
    const snapshot = await getPlanShare(token.data);
    if (!snapshot) throw notFound();
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json({ snapshot });
  })
);

sharesRouter.post(
  "/:id/revoke",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await revokePlanShare(req.user!.id, req.params.id))) throw notFound();
    res.status(204).end();
  })
);

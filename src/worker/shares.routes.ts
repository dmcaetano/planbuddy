import { Hono } from "hono";
import { friendTokenSchema, shareCreateSchema } from "../shared/schemas.js";
import { getCandidate } from "../server/plans/candidates.repo.js";
import { getPlanSpec } from "../server/plans/specs.repo.js";
import { gatherPlanContext, placeProvenanceView } from "../server/plans/engine/pipeline.js";
import { buildPublicSnapshot, createPlanShare, getPlanShare, revokePlanShare } from "../server/shares/repo.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";
import { publicTokenRateLimiter } from "./rateLimit.js";

// gatherPlanContext here does NOT run the AI/Overpass generation pipeline
// (that's runGeneration, a different function) — it only assembles
// existing memory + one weather fetch + one resolvePlaces call for an
// ALREADY-generated candidate, so this is safe to call directly from an
// ordinary request handler (no Workflow needed, unlike plan generation).
export const sharesRouter = new Hono();

sharesRouter.post("/", requireAuth, async (c) => {
  const body = await parseBody(c, shareCreateSchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const candidate = await getCandidate(body.candidateId);
  if (!candidate) return notFoundResponse(c);
  const spec = await getPlanSpec(userId, candidate.planSpecId);
  if (!spec) return notFoundResponse(c);
  const context = await gatherPlanContext(userId, spec);
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
  const share = await createPlanShare(userId, candidate.id, snapshot);
  return c.json({ share }, 201);
});

sharesRouter.get("/:token", publicTokenRateLimiter, async (c) => {
  const token = friendTokenSchema.safeParse(c.req.param("token"));
  if (!token.success) return notFoundResponse(c);
  const snapshot = await getPlanShare(token.data);
  if (!snapshot) return notFoundResponse(c);
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("Referrer-Policy", "no-referrer");
  return c.json({ snapshot });
});

sharesRouter.post("/:id/revoke", requireAuth, async (c) => {
  if (!(await revokePlanShare(c.get("user")!.id, c.req.param("id")))) return notFoundResponse(c);
  return c.json({ ok: true });
});

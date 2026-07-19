import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { hunchUpdateSchema } from "../../shared/schemas.js";
import { confirmHunch, dismissHunch, listHunchEvidence, listHunches } from "./hunches.repo.js";

export const hunchesRouter = Router();
hunchesRouter.use(requireAuth);

hunchesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const hunches = await listHunches(req.user!.id);
    res.json({ hunches });
  })
);

hunchesRouter.get(
  "/:id/evidence",
  asyncHandler(async (req, res) => {
    const evidence = await listHunchEvidence(req.params.id);
    res.json({ evidence });
  })
);

hunchesRouter.post(
  "/:id",
  validateBody(hunchUpdateSchema),
  asyncHandler(async (req, res) => {
    const { action } = req.body as { action: "confirm" | "dismiss" };
    const hunch =
      action === "confirm"
        ? await confirmHunch(req.user!.id, req.params.id)
        : await dismissHunch(req.user!.id, req.params.id);
    if (!hunch) throw notFound();
    res.json({ hunch });
  })
);

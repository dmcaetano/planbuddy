import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { hunchEditSchema, hunchUpdateSchema } from "../../shared/schemas.js";
import { confirmHunch, deleteHunch, dismissHunch, getHunch, listHunchEvidence, listHunches, updateHunch } from "./hunches.repo.js";

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
    const hunch = await getHunch(req.user!.id, req.params.id);
    if (!hunch) throw notFound();
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

hunchesRouter.patch(
  "/:id",
  validateBody(hunchEditSchema),
  asyncHandler(async (req, res) => {
    const hunch = await updateHunch(req.user!.id, req.params.id, req.body);
    if (!hunch) throw notFound();
    res.json({ hunch });
  })
);

hunchesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!(await deleteHunch(req.user!.id, req.params.id))) throw notFound();
    res.status(204).end();
  })
);

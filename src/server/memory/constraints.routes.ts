import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { constraintCreateSchema, constraintUpdateSchema } from "../../shared/schemas.js";
import {
  createConstraint,
  deleteConstraint,
  listConstraints,
  updateConstraint,
} from "./constraints.repo.js";

export const constraintsRouter = Router();
constraintsRouter.use(requireAuth);

constraintsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const constraints = await listConstraints(req.user!.id);
    res.json({ constraints });
  })
);

constraintsRouter.post(
  "/",
  validateBody(constraintCreateSchema),
  asyncHandler(async (req, res) => {
    // Directly typed constraints are verified immediately — no quote needed.
    const constraint = await createConstraint(req.user!.id, {
      participantId: req.body.participantId ?? null,
      text: req.body.text,
      status: "verified",
      source: "typed",
    });
    res.status(201).json({ constraint });
  })
);

constraintsRouter.patch(
  "/:id",
  validateBody(constraintUpdateSchema),
  asyncHandler(async (req, res) => {
    const constraint = await updateConstraint(req.user!.id, req.params.id, req.body);
    if (!constraint) throw notFound();
    res.json({ constraint });
  })
);

constraintsRouter.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const constraint = await updateConstraint(req.user!.id, req.params.id, { status: "verified" });
    if (!constraint) throw notFound();
    res.json({ constraint });
  })
);

constraintsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const ok = await deleteConstraint(req.user!.id, req.params.id);
    if (!ok) throw notFound();
    res.status(204).end();
  })
);

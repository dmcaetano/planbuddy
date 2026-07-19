import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { tasteCreateSchema, tasteUpdateSchema } from "../../shared/schemas.js";
import { createTaste, deleteTaste, listTastes, updateTaste } from "./tastes.repo.js";

export const tastesRouter = Router();
tastesRouter.use(requireAuth);

tastesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tastes = await listTastes(req.user!.id);
    res.json({ tastes });
  })
);

tastesRouter.post(
  "/",
  validateBody(tasteCreateSchema),
  asyncHandler(async (req, res) => {
    const taste = await createTaste(req.user!.id, {
      participantId: req.body.participantId ?? null,
      text: req.body.text,
      polarity: req.body.polarity,
      weight: req.body.weight,
      source: "stated",
    });
    res.status(201).json({ taste });
  })
);

tastesRouter.patch(
  "/:id",
  validateBody(tasteUpdateSchema),
  asyncHandler(async (req, res) => {
    const taste = await updateTaste(req.user!.id, req.params.id, req.body);
    if (!taste) throw notFound();
    res.json({ taste });
  })
);

tastesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const ok = await deleteTaste(req.user!.id, req.params.id);
    if (!ok) throw notFound();
    res.status(204).end();
  })
);

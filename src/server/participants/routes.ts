import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { participantCreateSchema, participantUpdateSchema } from "../../shared/schemas.js";
import {
  createParticipant,
  deleteParticipant,
  getParticipant,
  listParticipants,
  updateParticipant,
} from "./repo.js";

export const participantsRouter = Router();
participantsRouter.use(requireAuth);

participantsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const participants = await listParticipants(req.user!.id);
    res.json({ participants });
  })
);

participantsRouter.post(
  "/",
  validateBody(participantCreateSchema),
  asyncHandler(async (req, res) => {
    const participant = await createParticipant(req.user!.id, req.body);
    res.status(201).json({ participant });
  })
);

participantsRouter.patch(
  "/:id",
  validateBody(participantUpdateSchema),
  asyncHandler(async (req, res) => {
    const participant = await updateParticipant(req.user!.id, req.params.id, req.body);
    if (!participant) throw notFound();
    res.json({ participant });
  })
);

participantsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await getParticipant(req.user!.id, req.params.id);
    if (!existing) throw notFound();
    if (existing.isOwner) {
      res.status(400).json({ error: "The account owner cannot be removed" });
      return;
    }
    await deleteParticipant(req.user!.id, req.params.id);
    res.status(204).end();
  })
);

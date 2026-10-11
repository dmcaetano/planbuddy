// Thin Express wrapper. All business logic lives in ./service.js (split
// out 2026-10 so the Cloudflare Worker can import the logic without
// pulling in `express` — see that file's header comment for why).
import { Router } from "express";
import { asyncHandler, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { chatMessageCreateSchema, timeOffCreateSchema } from "../../shared/schemas.js";
import { createTimeOff } from "../timeoff/repo.js";
import { z } from "zod";
import { confirmRelationship, endChatSession, getChatSession, postChatMessage } from "./service.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    res.json(await getChatSession(req.user!.id));
  })
);

chatRouter.post(
  "/session/end",
  asyncHandler(async (req, res) => {
    res.json({ session: await endChatSession(req.user!.id) });
  })
);

chatRouter.post(
  "/session/:id/messages",
  aiRateLimiter,
  validateBody(chatMessageCreateSchema),
  asyncHandler(async (req, res) => {
    const result = await postChatMessage(req.user!.id, req.params.id, req.body.content);
    res.status(201).json(result);
  })
);

const confirmRelationshipSchema = z
  .object({
    participantId: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    relationship: z.string().trim().min(1).max(120),
  })
  .refine((v) => v.participantId || v.name, { message: "participantId or name is required" });

// The confirm tap is what performs the write. Tenant-scoped; the owner cannot be edited here.
chatRouter.post(
  "/confirm-relationship",
  validateBody(confirmRelationshipSchema),
  asyncHandler(async (req, res) => {
    const result = await confirmRelationship(req.user!.id, req.body as z.infer<typeof confirmRelationshipSchema>);
    res.status(result.created ? 201 : 200).json(result);
  })
);

// The confirm tap is what performs the write.
chatRouter.post(
  "/confirm-time-off",
  validateBody(timeOffCreateSchema),
  asyncHandler(async (req, res) => {
    const timeOff = await createTimeOff(req.user!.id, req.body);
    res.status(201).json({ timeOff });
  })
);

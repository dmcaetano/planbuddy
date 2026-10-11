import { Hono } from "hono";
import { chatMessageCreateSchema, timeOffCreateSchema } from "../shared/schemas.js";
import { createTimeOff } from "../server/timeoff/repo.js";
import { confirmRelationship, endChatSession, getChatSession, postChatMessage } from "../server/chat/service.js";
import { requireAuth } from "./middleware.js";
import { parseBody } from "./http.js";
import { aiRateLimiter } from "./rateLimit.js";
import { z } from "zod";

const confirmRelationshipSchema = z
  .object({
    participantId: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    relationship: z.string().trim().min(1).max(120),
  })
  .refine((v) => v.participantId || v.name, { message: "participantId or name is required" });

export const chatRouter = new Hono();
chatRouter.use("*", requireAuth);

chatRouter.get("/session", async (c) => {
  return c.json(await getChatSession(c.get("user")!.id));
});

chatRouter.post("/session/end", async (c) => {
  return c.json({ session: await endChatSession(c.get("user")!.id) });
});

chatRouter.post("/session/:id/messages", aiRateLimiter, async (c) => {
  const body = await parseBody(c, chatMessageCreateSchema);
  if (body instanceof Response) return body;
  const result = await postChatMessage(c.get("user")!.id, c.req.param("id"), body.content);
  return c.json(result, 201);
});

chatRouter.post("/confirm-relationship", async (c) => {
  const body = await parseBody(c, confirmRelationshipSchema);
  if (body instanceof Response) return body;
  const result = await confirmRelationship(c.get("user")!.id, body);
  return c.json(result, result.created ? 201 : 200);
});

chatRouter.post("/confirm-time-off", async (c) => {
  const body = await parseBody(c, timeOffCreateSchema);
  if (body instanceof Response) return body;
  const timeOff = await createTimeOff(c.get("user")!.id, body);
  return c.json({ timeOff }, 201);
});

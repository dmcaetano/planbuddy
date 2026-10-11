import { Hono } from "hono";
import { participantCreateSchema, participantUpdateSchema } from "../shared/schemas.js";
import {
  createParticipant,
  deleteParticipant,
  getParticipant,
  listParticipants,
  updateParticipant,
} from "../server/participants/repo.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";

export const participantsRouter = new Hono();
participantsRouter.use("*", requireAuth);

participantsRouter.get("/", async (c) => {
  const participants = await listParticipants(c.get("user")!.id);
  return c.json({ participants });
});

participantsRouter.post("/", async (c) => {
  const body = await parseBody(c, participantCreateSchema);
  if (body instanceof Response) return body;
  const participant = await createParticipant(c.get("user")!.id, body);
  return c.json({ participant }, 201);
});

participantsRouter.patch("/:id", async (c) => {
  const body = await parseBody(c, participantUpdateSchema);
  if (body instanceof Response) return body;
  const participant = await updateParticipant(c.get("user")!.id, c.req.param("id"), body);
  if (!participant) return notFoundResponse(c);
  return c.json({ participant });
});

participantsRouter.delete("/:id", async (c) => {
  const userId = c.get("user")!.id;
  const id = c.req.param("id");
  const existing = await getParticipant(userId, id);
  if (!existing) return notFoundResponse(c);
  if (existing.isOwner) {
    return c.json({ error: "The account owner cannot be removed" }, 400);
  }
  await deleteParticipant(userId, id);
  return c.body(null, 204);
});

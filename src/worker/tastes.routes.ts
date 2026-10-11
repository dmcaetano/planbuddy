import { Hono } from "hono";
import { tasteCreateSchema, tasteUpdateSchema, quizSubmitSchema } from "../shared/schemas.js";
import { createTaste, deleteTaste, deleteTastesBySource, listTastes, updateTaste } from "../server/memory/tastes.repo.js";
import { createConstraint, deleteConstraintsBySource } from "../server/memory/constraints.repo.js";
import { listParticipants } from "../server/participants/repo.js";
import { QUIZ_CONSTRAINT_SOURCE, QUIZ_TASTE_SOURCE, resolveQuizWrites } from "../shared/quiz.js";
import type { Constraint, Taste } from "../shared/types.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";

export const tastesRouter = new Hono();
tastesRouter.use("*", requireAuth);

tastesRouter.get("/", async (c) => {
  const tastes = await listTastes(c.get("user")!.id);
  return c.json({ tastes });
});

tastesRouter.post("/", async (c) => {
  const body = await parseBody(c, tasteCreateSchema);
  if (body instanceof Response) return body;
  const taste = await createTaste(c.get("user")!.id, {
    participantId: body.participantId ?? null,
    text: body.text,
    polarity: body.polarity,
    weight: body.weight,
    source: "stated",
  });
  return c.json({ taste }, 201);
});

tastesRouter.post("/quiz", async (c) => {
  const body = await parseBody(c, quizSubmitSchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const owner = (await listParticipants(userId)).find((p) => p.isOwner);
  const participantId = owner?.id ?? null;

  const writes = resolveQuizWrites(body.answers);

  await deleteTastesBySource(userId, QUIZ_TASTE_SOURCE);
  await deleteConstraintsBySource(userId, QUIZ_CONSTRAINT_SOURCE);

  const tastes: Taste[] = [];
  const constraints: Constraint[] = [];

  for (const write of writes) {
    if (write.taste) {
      const taste = await createTaste(userId, {
        participantId,
        text: write.taste.text,
        polarity: write.taste.polarity,
        source: QUIZ_TASTE_SOURCE,
      });
      tastes.push(taste);
    }
    if (write.constraint) {
      const constraint = await createConstraint(userId, {
        participantId,
        text: write.constraint.text,
        status: "verified",
        source: QUIZ_CONSTRAINT_SOURCE,
      });
      constraints.push(constraint);
    }
  }

  return c.json({ tastes, constraints }, 201);
});

tastesRouter.patch("/:id", async (c) => {
  const body = await parseBody(c, tasteUpdateSchema);
  if (body instanceof Response) return body;
  const taste = await updateTaste(c.get("user")!.id, c.req.param("id"), body);
  if (!taste) return notFoundResponse(c);
  return c.json({ taste });
});

tastesRouter.delete("/:id", async (c) => {
  const ok = await deleteTaste(c.get("user")!.id, c.req.param("id"));
  if (!ok) return notFoundResponse(c);
  return c.body(null, 204);
});

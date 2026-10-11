import { Hono } from "hono";
import { constraintCreateSchema, constraintUpdateSchema } from "../shared/schemas.js";
import { createConstraint, deleteConstraint, listConstraints, updateConstraint } from "../server/memory/constraints.repo.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";

export const constraintsRouter = new Hono();
constraintsRouter.use("*", requireAuth);

constraintsRouter.get("/", async (c) => {
  const constraints = await listConstraints(c.get("user")!.id);
  return c.json({ constraints });
});

constraintsRouter.post("/", async (c) => {
  const body = await parseBody(c, constraintCreateSchema);
  if (body instanceof Response) return body;
  const constraint = await createConstraint(c.get("user")!.id, {
    participantId: body.participantId ?? null,
    text: body.text,
    status: "verified",
    source: "typed",
  });
  return c.json({ constraint }, 201);
});

constraintsRouter.patch("/:id", async (c) => {
  const body = await parseBody(c, constraintUpdateSchema);
  if (body instanceof Response) return body;
  const constraint = await updateConstraint(c.get("user")!.id, c.req.param("id"), body);
  if (!constraint) return notFoundResponse(c);
  return c.json({ constraint });
});

constraintsRouter.post("/:id/confirm", async (c) => {
  const constraint = await updateConstraint(c.get("user")!.id, c.req.param("id"), { status: "verified" });
  if (!constraint) return notFoundResponse(c);
  return c.json({ constraint });
});

constraintsRouter.delete("/:id", async (c) => {
  const ok = await deleteConstraint(c.get("user")!.id, c.req.param("id"));
  if (!ok) return notFoundResponse(c);
  return c.body(null, 204);
});

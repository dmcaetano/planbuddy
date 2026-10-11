import { Hono } from "hono";
import { hunchEditSchema, hunchUpdateSchema } from "../shared/schemas.js";
import {
  confirmHunch,
  deleteHunch,
  dismissHunch,
  getHunch,
  listHunchEvidence,
  listHunches,
  updateHunch,
} from "../server/memory/hunches.repo.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";

export const hunchesRouter = new Hono();
hunchesRouter.use("*", requireAuth);

hunchesRouter.get("/", async (c) => {
  const hunches = await listHunches(c.get("user")!.id);
  return c.json({ hunches });
});

hunchesRouter.get("/:id/evidence", async (c) => {
  const hunch = await getHunch(c.get("user")!.id, c.req.param("id"));
  if (!hunch) return notFoundResponse(c);
  const evidence = await listHunchEvidence(c.req.param("id"));
  return c.json({ evidence });
});

hunchesRouter.post("/:id", async (c) => {
  const body = await parseBody(c, hunchUpdateSchema);
  if (body instanceof Response) return body;
  const { action } = body as { action: "confirm" | "dismiss" };
  const userId = c.get("user")!.id;
  const id = c.req.param("id");
  const hunch = action === "confirm" ? await confirmHunch(userId, id) : await dismissHunch(userId, id);
  if (!hunch) return notFoundResponse(c);
  return c.json({ hunch });
});

hunchesRouter.patch("/:id", async (c) => {
  const body = await parseBody(c, hunchEditSchema);
  if (body instanceof Response) return body;
  const hunch = await updateHunch(c.get("user")!.id, c.req.param("id"), body);
  if (!hunch) return notFoundResponse(c);
  return c.json({ hunch });
});

hunchesRouter.delete("/:id", async (c) => {
  if (!(await deleteHunch(c.get("user")!.id, c.req.param("id")))) return notFoundResponse(c);
  return c.body(null, 204);
});

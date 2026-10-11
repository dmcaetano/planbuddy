import { Hono } from "hono";
import { timeOffCreateSchema, timeOffSnoozeSchema, timeOffUpdateSchema } from "../shared/schemas.js";
import { addDays } from "../shared/moment.js";
import {
  createTimeOff,
  deleteTimeOff,
  getTimeOff,
  listTimeOff,
  setSnoozedUntil,
  updateTimeOff,
} from "../server/timeoff/repo.js";
import { refreshIdeas } from "../server/timeoff/tripIdeas.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";
import { aiRateLimiter } from "./rateLimit.js";

export const SNOOZE_DAYS = 7;

export const timeOffRouter = new Hono();
timeOffRouter.use("*", requireAuth);

timeOffRouter.get("/", async (c) => {
  return c.json({ timeOff: await listTimeOff(c.get("user")!.id) });
});

timeOffRouter.post("/", async (c) => {
  const body = await parseBody(c, timeOffCreateSchema);
  if (body instanceof Response) return body;
  return c.json({ timeOff: await createTimeOff(c.get("user")!.id, body) }, 201);
});

timeOffRouter.patch("/:id", async (c) => {
  const body = await parseBody(c, timeOffUpdateSchema);
  if (body instanceof Response) return body;
  const userId = c.get("user")!.id;
  const id = c.req.param("id");
  const existing = await getTimeOff(userId, id);
  if (!existing) return notFoundResponse(c);
  const startDate = body.startDate ?? existing.startDate;
  const endDate = body.endDate ?? existing.endDate;
  if (endDate < startDate) {
    return c.json({ error: "The end date can't be before the start date" }, 400);
  }
  const timeOff = await updateTimeOff(userId, id, body);
  if (!timeOff) return notFoundResponse(c);
  return c.json({ timeOff });
});

timeOffRouter.delete("/:id", async (c) => {
  if (!(await deleteTimeOff(c.get("user")!.id, c.req.param("id")))) return notFoundResponse(c);
  return c.body(null, 204);
});

timeOffRouter.post("/:id/snooze", async (c) => {
  const body = await parseBody(c, timeOffSnoozeSchema);
  if (body instanceof Response) return body;
  const localDate: string = body.localDate ?? new Date().toISOString().slice(0, 10);
  const timeOff = await setSnoozedUntil(c.get("user")!.id, c.req.param("id"), addDays(localDate, SNOOZE_DAYS));
  if (!timeOff) return notFoundResponse(c);
  return c.json({ timeOff });
});

timeOffRouter.post("/:id/unsnooze", async (c) => {
  const timeOff = await setSnoozedUntil(c.get("user")!.id, c.req.param("id"), null);
  if (!timeOff) return notFoundResponse(c);
  return c.json({ timeOff });
});

timeOffRouter.post("/:id/ideas", aiRateLimiter, async (c) => {
  const userId = c.get("user")!.id;
  const timeOff = await getTimeOff(userId, c.req.param("id"));
  if (!timeOff) return notFoundResponse(c);
  return c.json({ ideas: await refreshIdeas(userId, timeOff) });
});

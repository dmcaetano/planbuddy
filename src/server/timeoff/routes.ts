import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { timeOffCreateSchema, timeOffSnoozeSchema, timeOffUpdateSchema } from "../../shared/schemas.js";
import { addDays } from "../../shared/moment.js";
import {
  createTimeOff,
  deleteTimeOff,
  getTimeOff,
  listTimeOff,
  setSnoozedUntil,
  updateTimeOff,
} from "./repo.js";
import { refreshIdeas } from "./tripIdeas.js";

export const SNOOZE_DAYS = 7;

export const timeOffRouter = Router();
timeOffRouter.use(requireAuth);

timeOffRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ timeOff: await listTimeOff(req.user!.id) });
  })
);

timeOffRouter.post(
  "/",
  validateBody(timeOffCreateSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ timeOff: await createTimeOff(req.user!.id, req.body) });
  })
);

timeOffRouter.patch(
  "/:id",
  validateBody(timeOffUpdateSchema),
  asyncHandler(async (req, res) => {
    const existing = await getTimeOff(req.user!.id, req.params.id);
    if (!existing) throw notFound();
    const startDate = req.body.startDate ?? existing.startDate;
    const endDate = req.body.endDate ?? existing.endDate;
    if (endDate < startDate) {
      res.status(400).json({ error: "The end date can't be before the start date" });
      return;
    }
    const timeOff = await updateTimeOff(req.user!.id, req.params.id, req.body);
    if (!timeOff) throw notFound();
    res.json({ timeOff });
  })
);

timeOffRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!(await deleteTimeOff(req.user!.id, req.params.id))) throw notFound();
    res.status(204).end();
  })
);

/** "Not now": hides the nudge for 7 days counted from the device-local date. */
timeOffRouter.post(
  "/:id/snooze",
  validateBody(timeOffSnoozeSchema),
  asyncHandler(async (req, res) => {
    const localDate: string = req.body.localDate ?? new Date().toISOString().slice(0, 10);
    const timeOff = await setSnoozedUntil(req.user!.id, req.params.id, addDays(localDate, SNOOZE_DAYS));
    if (!timeOff) throw notFound();
    res.json({ timeOff });
  })
);

/** "Show again". */
timeOffRouter.post(
  "/:id/unsnooze",
  asyncHandler(async (req, res) => {
    const timeOff = await setSnoozedUntil(req.user!.id, req.params.id, null);
    if (!timeOff) throw notFound();
    res.json({ timeOff });
  })
);

/** "Other ideas" / "Show ideas": a fresh pair of text ideas. Creates no plan rows and uses no job slot. */
timeOffRouter.post(
  "/:id/ideas",
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const timeOff = await getTimeOff(req.user!.id, req.params.id);
    if (!timeOff) throw notFound();
    res.json({ ideas: await refreshIdeas(req.user!.id, timeOff) });
  })
);

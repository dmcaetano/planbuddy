import { Router } from "express";
import { asyncHandler, HttpError } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { geocodeCity, getForecast } from "./openMeteo.js";
import { getUserById } from "../users/repo.js";
import type { WeatherSnapshot } from "../../shared/types.js";

export const weatherRouter = Router();
weatherRouter.use(requireAuth);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the forecast implies for a plan's setting. Deliberately conservative:
 * only a genuinely wet, cold, or punishing forecast overrides "mixed", so the
 * one-tap buttons nudge rather than dictate.
 */
export function suggestedSetting(weather: WeatherSnapshot): "mixed" | "outdoors" | "indoors" {
  if (weather.unavailable) return "mixed";
  const rainLikely = (weather.precipitationProbability ?? 0) >= 55;
  const cold = weather.temperatureC != null && weather.temperatureC < 10;
  const scorching = weather.apparentTemperatureC != null && weather.apparentTemperatureC >= 34;
  if (rainLikely || cold || scorching) return "indoors";
  const dry = (weather.precipitationProbability ?? 0) <= 25;
  const pleasant = weather.temperatureC != null && weather.temperatureC >= 16 && weather.temperatureC <= 30;
  return dry && pleasant ? "outdoors" : "mixed";
}

weatherRouter.get(
  "/geocode",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }
    const results = await geocodeCity(q);
    res.json({ results });
  })
);

/**
 * Home-base forecast for a date range, used by the "plan the time I have left"
 * buttons so the user sees the weather their plan will be built around before
 * they commit to it. Returns weather: null when no home base is set yet.
 */
weatherRouter.get(
  "/outlook",
  asyncHandler(async (req, res) => {
    const startDate = String(req.query.startDate ?? "");
    const endDate = String(req.query.endDate ?? startDate);
    if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || endDate < startDate) {
      throw new HttpError(400, "startDate and endDate must be YYYY-MM-DD, with endDate on or after startDate");
    }

    const user = await getUserById(req.user!.id);
    if (user?.homeBaseLat == null || user?.homeBaseLng == null) {
      res.json({ weather: null, setting: "mixed" });
      return;
    }

    const weather = await getForecast(user.homeBaseLat, user.homeBaseLng, startDate, endDate);
    res.json({ weather, setting: suggestedSetting(weather) });
  })
);

import { Hono } from "hono";
import { geocodeCity } from "../server/weather/openMeteo.js";
import { requireAuth } from "./middleware.js";

export const weatherRouter = new Hono();
weatherRouter.use("*", requireAuth);

weatherRouter.get("/geocode", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) {
    return c.json({ results: [] });
  }
  const results = await geocodeCity(q);
  return c.json({ results });
});

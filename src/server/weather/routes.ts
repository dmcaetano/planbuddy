import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { geocodeCity } from "./openMeteo.js";

export const weatherRouter = Router();
weatherRouter.use(requireAuth);

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

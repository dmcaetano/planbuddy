import { z } from "zod";
import type { GenerateContext } from "../../ai/demoAi.js";
import { callAiJson } from "../../ai/deepseek.js";
import { currentAiMode } from "../../ai/index.js";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import type { ResolvedVenue } from "../../resolver/placeResolver.js";
import {
  buildCandidateFromPicks,
  buildCatalogCandidateWithMatch,
  buildCatalogShortlist,
  type CatalogMatch,
  type CatalogShortlist,
} from "./catalogPlanner.js";
import { clockToMinutes } from "../../../shared/moment.js";
import type { ProgressReporter } from "./stages.js";
import { pickRouteWithAgent } from "./routeAgent.js";

/**
 * DeepSeek proposes, the server validates (standing project decision). The model only CHOOSES among
 * real catalogue venues listed by id; it can never introduce a place. Deliberate override of spec
 * rule 27 at Diogo's instruction (see sdlc/001-max-one-click/spec.md, Amendment 2026-10-05).
 */
export const routePickSchema = z.object({
  mealId: z.string().min(1),
  firstStopId: z.string().min(1),
  secondStopId: z.string().min(1),
  title: z.string().min(1).max(90),
  why: z.string().min(1).max(240),
});
export type RoutePick = z.infer<typeof routePickSchema>;

const SYSTEM_PROMPT = [
  "You choose ONE real outing route for a group from a list of real venues. Use ONLY the venue ids listed; never invent a place or an id.",
  "A route is: one restaurant (mealId) plus two different nearby non-food stops from THAT restaurant's own stop list (firstStopId, secondStopId).",
  "Prefer places a local would genuinely recommend: well-known, characterful restaurants over chains, tourist traps, food courts, hotel bars and fast food.",
  "Match the group's loved tastes and the occasion (a romantic evening when flagged; lunch/day versus dinner). Never pick anything that conflicts with the avoid tastes or the constraints.",
  "Strongly prefer restaurants close to home (kmFromHome): choose one under about 8 km when any fits the tastes, and go further only when nothing close does or the request asks for a trip further out; never choose a place that needs a ferry or a long detour for an ordinary evening.",
  "Respect opening hours: after 19:00 do not pick museums, galleries, palaces, castles, monuments or churches (closed); use viewpoints, gardens lit at night, waterfront, squares or a dessert/drink spot instead. Do not pick fountains (chafariz), prisons/forts (presídio) or bare monuments as a stop - a stop should be somewhere worth walking to.",
  "Write title and why in English even when venue names are Portuguese.",
  "Keep the stops close to the restaurant, make the two stops different in kind, and use the weather (indoors when it is wet or cold, outdoors when it is mild).",
  'Reply with JSON only: {"mealId","firstStopId","secondStopId","title","why"}. title: at most 90 characters, a short natural name for the outing. why: at most 240 characters, ONE sentence naming the actual taste or occasion this route fits.',
].join("\n");

function mealKind(ctx: GenerateContext): string {
  const request = ctx.moodContext ?? "";
  if (/\blunch|midday|noon\b/i.test(request)) return "lunch";
  if (/\bdinner|evening|night\b/i.test(request)) return "dinner";
  const start = clockToMinutes(ctx.moment?.mealStart ?? ctx.moment?.startTime ?? null);
  if (start != null) return start < 16 * 60 ? "lunch" : "dinner";
  return "a meal";
}

export function buildPickerPrompt(ctx: GenerateContext, shortlist: CatalogShortlist): string {
  const loves = ctx.loveTastes.map((taste) => taste.text);
  const avoids = (ctx.avoidTastes ?? []).map((taste) => taste.text);
  const hunchLoves = (ctx.preferenceHunches ?? []).filter((hunch) => hunch.polarity === "love").map((hunch) => hunch.text);
  const hunchAvoids = (ctx.preferenceHunches ?? []).filter((hunch) => hunch.polarity === "avoid").map((hunch) => hunch.text);
  const recent = (ctx.recentSuggestions ?? []).flatMap((suggestion) => suggestion.placeNames).slice(0, 12);
  const weather = ctx.weather && !ctx.weather.unavailable
    ? `${ctx.weather.summary}${ctx.weather.temperatureC != null ? `, ${Math.round(ctx.weather.temperatureC)}C` : ""}${ctx.weather.precipitationProbability != null ? `, ${ctx.weather.precipitationProbability}% rain` : ""}`
    : "unknown";
  const people = (ctx.participants ?? []).map((participant) => `${participant.name} (${participant.kind})`).join(", ");
  const lines = shortlist.meals.map((meal) =>
    JSON.stringify({
      id: meal.id,
      name: meal.name,
      kind: meal.kind,
      tags: meal.tags,
      kmFromHome: meal.homeKm,
      stops: meal.stops.map((stop) => ({ id: stop.id, name: stop.name, kind: stop.kind, tags: stop.tags, kmFromRestaurant: stop.distanceKm })),
    })
  );
  return [
    `Occasion: ${mealKind(ctx)}${ctx.moment?.romantic ? ", a romantic evening for two" : ""}${ctx.moment ? ` (${ctx.moment.kind}${ctx.moment.startTime ? `, starts ${ctx.moment.startTime}` : ""}${ctx.moment.mealFirst ? ", meal comes first, then the stops" : ", a first stop, then the meal, then a last stop"})` : ""}.`,
    `Group: ${people || "the user"}.`,
    `Request: ${ctx.moodContext ?? "none"}`,
    `Loved tastes: ${[...loves, ...hunchLoves].join("; ") || "none stated"}.`,
    `Avoid tastes: ${[...avoids, ...hunchAvoids].join("; ") || "none"}.`,
    `Hard constraints: ${ctx.activeConstraints.map((constraint) => constraint.text).join("; ") || "none"}.`,
    `Recently suggested (avoid): ${recent.join("; ") || "none"}.`,
    `Weather: ${weather}.`,
    "",
    "Restaurants (one JSON object per line, each with its own allowed stops):",
    ...lines,
  ].join("\n");
}

/**
 * Asks the model to choose a route from the shortlist. Returns null on ANY failure (no shortlist,
 * timeout, bad JSON, schema miss, ids that are not in the shortlist or not the restaurant's own stops).
 */
export async function pickRouteWithModel(
  ctx: GenerateContext,
  shortlist: CatalogShortlist,
  venues?: ResolvedVenue[],
  onEvent?: (detail: string) => void
): Promise<RoutePick | null> {
  if (shortlist.meals.length === 0) return null;
  if (venues && env.AI_AGENT_ENABLED) {
    const agentPick = await pickRouteWithAgent(ctx, venues, onEvent);
    if (agentPick) return agentPick;
    onEvent?.("Falling back to a quicker pick");
  }
  try {
    const pick = await callAiJson(SYSTEM_PROMPT, buildPickerPrompt(ctx, shortlist), routePickSchema, { fast: true });
    const meal = shortlist.meals.find((item) => item.id === pick.mealId);
    const stopIds = new Set(meal?.stops.map((stop) => stop.id));
    if (!meal || !stopIds.has(pick.firstStopId) || !stopIds.has(pick.secondStopId) || pick.firstStopId === pick.secondStopId) {
      logger.warn("Model route pick referenced ids outside the shortlist; ignoring", { mealId: pick.mealId });
      return null;
    }
    return pick;
  } catch (error) {
    logger.warn("Model route pick failed", { error: String(error) });
    return null;
  }
}

export interface CatalogSelectionDeps {
  modelAvailable: () => boolean;
  pick: (
    ctx: GenerateContext,
    shortlist: CatalogShortlist,
    venues?: ResolvedVenue[],
    onEvent?: (detail: string) => void
  ) => Promise<RoutePick | null>;
}

const defaultDeps: CatalogSelectionDeps = {
  modelAvailable: () => currentAiMode() !== "demo",
  pick: pickRouteWithModel,
};

/** Model-chosen route when available and valid, otherwise the deterministic catalogue route. */
export async function selectCatalogMatch(
  ctx: GenerateContext,
  venues: ResolvedVenue[],
  report?: ProgressReporter,
  deps: CatalogSelectionDeps = defaultDeps
): Promise<CatalogMatch | null> {
  if (deps.modelAvailable()) {
    try {
      await report?.("composing_plan", `Choosing the best ${mealKind(ctx) === "a meal" ? "meal" : mealKind(ctx)} spot near you`);
      const shortlist = buildCatalogShortlist(ctx, venues);
      if (shortlist.meals.length > 0) {
        await report?.("composing_plan", `Weighing ${shortlist.meals.length} ${mealKind(ctx) === "a meal" ? "restaurants" : `${mealKind(ctx)} spots`} near you`);
      }
      const pick = await deps.pick(ctx, shortlist, venues, (detail) => {
        void report?.("composing_plan", detail);
      });
      const match = pick
        ? buildCandidateFromPicks(ctx, venues, pick, { title: pick.title, rationale: pick.why })
        : null;
      if (match) {
        const mealName = shortlist.meals.find((item) => item.id === pick!.mealId)?.name;
        if (mealName) await report?.("composing_plan", `${mealKind(ctx) === "lunch" ? "Lunch" : "Dinner"} pick: ${mealName}. Lining up the stops`);
        return match;
      }
      logger.warn("Model route unusable; falling back to the deterministic catalogue route", { hadPick: Boolean(pick) });
    } catch (error) {
      logger.warn("Model route selection errored; falling back to the deterministic catalogue route", { error: String(error) });
    }
  }
  return buildCatalogCandidateWithMatch(ctx, venues);
}

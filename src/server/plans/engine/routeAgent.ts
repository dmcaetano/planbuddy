import { z } from "zod";
import type { GenerateContext } from "../../ai/demoAi.js";
import { callAiToolLoop, type AgentTool } from "../../ai/deepseek.js";
import { logger } from "../../logger.js";
import type { ResolvedVenue } from "../../resolver/placeResolver.js";
import { routePickIssue, searchRestaurants, stopsNearVenue } from "./catalogPlanner.js";

const submitSchema = z.object({
  mealId: z.string().min(1),
  firstStopId: z.string().min(1),
  secondStopId: z.string().min(1),
  title: z.string().min(1).max(90),
  why: z.string().min(1).max(240),
});
export type AgentRoutePick = z.infer<typeof submitSchema>;

const SYSTEM_PROMPT = [
  "You are the planner for PlanBuddy. You build ONE real outing route for a group: one restaurant plus two different nearby non-food stops.",
  "You have tools. Use them: read the group's profile and history first, search the real venue catalogue for restaurants, look up the walkable stops around the restaurants you like, test a candidate route with check_route, then finish with submit_route.",
  "You may only use venue ids returned by the tools. Never invent a place or an id; the server rejects anything else.",
  "Do real work before committing: search with several different queries that reflect the loved tastes and the occasion, compare a few restaurants, and read their stop lists. Do not take the first result.",
  "Prefer places a local would recommend over chains, tourist traps, food courts and hotel bars. Match loved tastes and the occasion; never break the avoid tastes or constraints. Keep the restaurant reasonably close to home unless the request asks for a trip.",
  "Respect opening hours: after 19:00 avoid museums, galleries, palaces, castles, monuments and churches. Use the weather (indoors when wet or cold).",
  "Always call check_route on your final choice. If it reports an issue, fix it and check again. Finish by calling submit_route.",
  "Write title and why in English even when venue names are Portuguese. title at most 90 characters; why at most 240 characters, ONE sentence naming the actual taste or occasion this route fits.",
].join("\n");

const idArgs = {
  mealId: { type: "string", description: "Restaurant venue id from search_restaurants" },
  firstStopId: { type: "string", description: "First stop id from get_stops_near for that restaurant" },
  secondStopId: { type: "string", description: "Second stop id (different kind from the first)" },
};

const TOOLS: AgentTool[] = [
  {
    name: "get_profile",
    description: "The group, the request, the occasion, loved and avoided tastes, hard constraints and the weather.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_recent_plans",
    description: "Places already suggested recently. Do not repeat them.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_restaurants",
    description: "Search real restaurants near home, ranked by fit with the loved tastes. Query matches name, kind and tags (e.g. 'seafood', 'tasca', 'sushi'). Empty query returns the best overall.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_home_km: { type: "number", description: "Only restaurants within this many km of home" },
        limit: { type: "integer", description: "Default 8, max 15" },
        offset: { type: "integer", description: "Skip this many results to page further" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_stops_near",
    description: "Walkable non-food stops around one restaurant (viewpoints, gardens, culture, dessert), best first.",
    parameters: {
      type: "object",
      properties: {
        restaurant_id: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer", description: "Default 8, max 15" },
      },
      required: ["restaurant_id"],
      additionalProperties: false,
    },
  },
  {
    name: "check_route",
    description: "Validate a candidate route against all server rules without submitting. Returns ok or the exact issue.",
    parameters: { type: "object", properties: idArgs, required: ["mealId", "firstStopId", "secondStopId"], additionalProperties: false },
  },
  {
    name: "submit_route",
    description: "Submit the final route. Only accepted if it passes every rule; otherwise the issue is returned and you must fix it.",
    parameters: {
      type: "object",
      properties: {
        ...idArgs,
        title: { type: "string", description: "Short natural name for the outing, max 90 chars" },
        why: { type: "string", description: "One sentence, max 240 chars, naming the taste or occasion it fits" },
      },
      required: ["mealId", "firstStopId", "secondStopId", "title", "why"],
      additionalProperties: false,
    },
  },
];

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function profileOf(ctx: GenerateContext) {
  const weather = ctx.weather && !ctx.weather.unavailable
    ? {
        summary: ctx.weather.summary,
        temperatureC: ctx.weather.temperatureC ?? null,
        rainChancePercent: ctx.weather.precipitationProbability ?? null,
      }
    : "unknown";
  return {
    group: (ctx.participants ?? []).map((p) => `${p.name} (${p.kind})`),
    request: ctx.moodContext ?? "none",
    occasion: ctx.moment
      ? {
          kind: ctx.moment.kind,
          startTime: ctx.moment.startTime ?? null,
          romantic: Boolean(ctx.moment.romantic),
          order: ctx.moment.mealFirst ? "meal first, then the stops" : "a first stop, then the meal, then a last stop",
        }
      : "unspecified",
    lovedTastes: [...ctx.loveTastes.map((t) => t.text), ...(ctx.preferenceHunches ?? []).filter((h) => h.polarity === "love").map((h) => h.text)],
    avoidTastes: [...(ctx.avoidTastes ?? []).map((t) => t.text), ...(ctx.preferenceHunches ?? []).filter((h) => h.polarity === "avoid").map((h) => h.text)],
    hardConstraints: ctx.activeConstraints.map((c) => c.text),
    weather,
  };
}

/**
 * Reasoning DeepSeek agent that researches the catalogue through read-only tools and submits a route.
 * The submit is validated by the same server rules as every other path, so the agent can never
 * introduce a place. Returns null on any failure so the caller falls back to the single-shot picker.
 */
export async function pickRouteWithAgent(
  ctx: GenerateContext,
  venues: ResolvedVenue[],
  onEvent?: (detail: string) => void
): Promise<AgentRoutePick | null> {
  if (ctx.homeBaseLat == null || ctx.homeBaseLng == null) return null;
  const names = new Map(venues.map((venue) => [venue.id, venue.name]));
  const nameOf = (id: unknown) => (typeof id === "string" ? names.get(id) ?? "that place" : "that place");
  try {
    const { done, steps } = await callAiToolLoop({
      system: SYSTEM_PROMPT,
      user: "Plan the outing now. Start by reading the profile and recent plans, then search and compare before you submit.",
      tools: TOOLS,
      onEvent,
      run: (name, args) => {
        switch (name) {
          case "get_profile":
            return { output: profileOf(ctx), narration: "Reading your tastes and the occasion" };
          case "get_recent_plans":
            return {
              output: { recentPlaces: (ctx.recentSuggestions ?? []).flatMap((s) => s.placeNames).slice(0, 24) },
              narration: "Checking what you did recently",
            };
          case "search_restaurants": {
            const query = str(args.query);
            const result = searchRestaurants(ctx, venues, {
              query,
              maxHomeKm: typeof args.max_home_km === "number" ? args.max_home_km : undefined,
              limit: num(args.limit, 8, 1, 15),
              offset: num(args.offset, 0, 0, 500),
            });
            return { output: result, narration: query ? `Searching restaurants: ${query}` : "Searching restaurants near you" };
          }
          case "get_stops_near": {
            const result = stopsNearVenue(ctx, venues, String(args.restaurant_id ?? ""), {
              query: str(args.query),
              limit: num(args.limit, 8, 1, 15),
            });
            return {
              output: result ?? { error: "unknown restaurant id" },
              narration: `Finding stops around ${nameOf(args.restaurant_id)}`,
            };
          }
          case "check_route": {
            const issue = routePickIssue(ctx, venues, {
              mealId: String(args.mealId ?? ""),
              firstStopId: String(args.firstStopId ?? ""),
              secondStopId: String(args.secondStopId ?? ""),
            });
            return { output: issue ? { ok: false, issue } : { ok: true }, narration: `Checking the route through ${nameOf(args.mealId)}` };
          }
          case "submit_route": {
            const parsed = submitSchema.safeParse(args);
            if (!parsed.success) return { output: { accepted: false, issue: "title (max 90) and why (max 240) are required, plus the three ids" } };
            const issue = routePickIssue(ctx, venues, parsed.data);
            if (issue) return { output: { accepted: false, issue } };
            return { output: { accepted: true }, done: parsed.data, narration: `Settled on ${nameOf(parsed.data.mealId)}` };
          }
          default:
            return { output: { error: `unknown tool ${name}` } };
        }
      },
    });
    if (!done) {
      logger.warn("Plan agent finished without a valid route", { steps });
      return null;
    }
    logger.info("Plan agent submitted a route", { steps });
    return done as AgentRoutePick;
  } catch (error) {
    logger.warn("Plan agent failed", { error: String(error) });
    return null;
  }
}

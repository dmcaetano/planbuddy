import { createHash } from "node:crypto";
import { z } from "zod";
import { callAiJson } from "../ai/deepseek.js";
import { currentAiMode } from "../ai/index.js";
import { logger } from "../logger.js";
import { HttpError } from "../http.js";
import { listParticipants } from "../participants/repo.js";
import { listTastes } from "../memory/tastes.repo.js";
import { lastSurfacedPlans } from "../plans/plans.repo.js";
import { getUserById } from "../users/repo.js";
import type { TimeOff, TripIdea } from "../../shared/momentTypes.js";
import { citableLoveTastes } from "./nudge.js";
import { getCachedIdeas, saveCachedIdeas } from "./repo.js";

/** Cached ideas are reused for this many days unless the range or the taste set changes (spec rule 19). */
export const IDEAS_MAX_AGE_DAYS = 14;
/** A real model call slower than this does not hold Home hostage; it finishes into the cache. */
const OPEN_BUDGET_MS = 8000;
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000;

/* ---------------------------------------------------------------------- */
/* Guardrails                                                              */
/* ---------------------------------------------------------------------- */

const PRICE_CLAIM =
  /[€$£¥]|\d\s?(?:€|eur|usd|gbp)\b|\b(?:eur|euros?|usd|gbp|dollars?|pounds?|prices?|priced|costs?|costing|cheap|cheaper|cheapest|budget|fares?|flights?|flying|airfares?|airlines?|availability|available|bookings?|book|tickets?|deals?|discounts?|per night|per person)\b/i;

/** True when a piece of idea text makes a price, flight or availability claim (rejected, spec rule 19). */
export function makesPriceClaim(text: string): boolean {
  return PRICE_CLAIM.test(text);
}

function plain(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** True when `name` already appears in the recent-plan text (a farther idea must not repeat one). */
export function namedInRecentPlans(name: string, recentText: string): boolean {
  const needle = plain(name).trim();
  return needle.length >= 3 && plain(recentText).includes(needle);
}

const ideaTextSchema = z.object({
  name: z.string().trim().min(2).max(80),
  reason: z.string().trim().min(8).max(200),
});

export function buildIdeasSchema(recentText: string, excludeNames: string[]) {
  return z
    .object({ local: ideaTextSchema, farther: ideaTextSchema })
    .superRefine((value, ctx) => {
      for (const key of ["local", "farther"] as const) {
        if (makesPriceClaim(value[key].name) || makesPriceClaim(value[key].reason)) {
          ctx.addIssue({ code: "custom", path: [key], message: "No price, flight or availability claims" });
        }
      }
      if (plain(value.local.name) === plain(value.farther.name)) {
        ctx.addIssue({ code: "custom", path: ["farther"], message: "The two ideas must be different places" });
      }
      if (namedInRecentPlans(value.farther.name, recentText)) {
        ctx.addIssue({ code: "custom", path: ["farther"], message: "The farther destination is already in the recent plans" });
      }
      for (const key of ["local", "farther"] as const) {
        if (excludeNames.some((name) => plain(name) === plain(value[key].name))) {
          ctx.addIssue({ code: "custom", path: [key], message: "Suggest a different place than the earlier ideas" });
        }
      }
    });
}

/* ---------------------------------------------------------------------- */
/* Facts and cache key                                                     */
/* ---------------------------------------------------------------------- */

interface IdeaFacts {
  homeBaseLabel: string | null;
  tastes: string[];
  tasteFingerprint: string;
  recentText: string;
  recentTitles: string[];
}

async function myTastes(userId: string) {
  const [tastes, participants] = await Promise.all([listTastes(userId), listParticipants(userId)]);
  const friendIds = new Set(participants.filter((p) => p.isFriendAccount).map((p) => p.id));
  return tastes.filter((taste) => !taste.participantId || !friendIds.has(taste.participantId));
}

/** The viewer's own and household-scoped love tastes that fit the dates (never a friend's). */
async function gatherFacts(userId: string, range: TimeOff): Promise<IdeaFacts> {
  const [user, mine, recent] = await Promise.all([getUserById(userId), myTastes(userId), lastSurfacedPlans(userId, 100)]);
  const texts = citableLoveTastes(mine, range).map((taste) => taste.text);
  const fingerprint = createHash("sha1").update([...texts].sort().join("\n")).digest("hex").slice(0, 16);
  return {
    homeBaseLabel: user?.homeBaseLabel ?? null,
    tastes: texts,
    tasteFingerprint: fingerprint,
    recentText: recent.map((plan) => `${plan.title} ${JSON.stringify(plan.beats)}`).join("\n"),
    recentTitles: recent.slice(0, 30).map((plan) => plan.title),
  };
}

/** The taste the nudge line may quote for this range: a love taste of the viewer or household that fits the season. */
export async function citableTasteFor(userId: string, range: TimeOff): Promise<{ id: string; text: string } | null> {
  return citableLoveTastes(await myTastes(userId), range)[0] ?? null;
}

/* ---------------------------------------------------------------------- */
/* Generation                                                              */
/* ---------------------------------------------------------------------- */

const DEMO_PAIRS: { local: [string, string]; farther: [string, string] }[] = [
  { local: ["Serra da Estrela", "A change of scenery within a few hours' reach."], farther: ["Vienna", "A bigger trip for a longer stretch of time off."] },
  { local: ["Douro Valley", "A scenic region for a slower few days."], farther: ["Copenhagen", "A city break worth a proper stretch of days."] },
  { local: ["Alentejo coast", "Open space and quiet roads, not far away."], farther: ["Edinburgh", "A walkable city for a longer trip."] },
];

let ideaGenerationCalls = 0;
/** Test hook: how many idea generations (model or demo) have run in this process. */
export function getIdeaGenerationCount(): number {
  return ideaGenerationCalls;
}

const lastFailure = new Map<string, number>();
const inflight = new Map<string, Promise<TripIdea[]>>();

function demoIdeas(excludeNames: string[], recentText: string): TripIdea[] {
  const taken = new Set(excludeNames.map(plain));
  const pair =
    DEMO_PAIRS.find((p) => !taken.has(plain(p.local[0])) && !namedInRecentPlans(p.farther[0], recentText)) ?? DEMO_PAIRS[0];
  return [
    { name: pair.local[0], reason: pair.local[1], scope: "getaway" },
    { name: pair.farther[0], reason: pair.farther[1], scope: "vacation" },
  ];
}

function buildPrompts(range: TimeOff, facts: IdeaFacts, excludeNames: string[]) {
  const system = [
    "You suggest exactly two trip ideas for someone who has time off. Reply with JSON only:",
    '{"local":{"name":string,"reason":string},"farther":{"name":string,"reason":string}}',
    "local: a destination reachable from the home base within a day of travel (a getaway of up to about 250 km).",
    "farther: a destination further away that suits a longer trip. It must not be a place from the recent plans list.",
    "name: just the place, 2 to 4 words. reason: one short sentence (under 150 characters) about why the place suits these dates or the stated tastes.",
    "Strict rules: never mention prices, costs, budgets, currencies, flights, airlines, fares, tickets, bookings, deals or availability.",
    "Do not state facts about weather forecasts or opening times. These are ideas, not promises.",
  ].join("\n");
  const user = [
    `Time off: ${range.label}, ${range.startDate} to ${range.endDate}`,
    `Home base: ${facts.homeBaseLabel ?? "unknown"}`,
    "Tastes the traveller loves:",
    ...(facts.tastes.length ? facts.tastes.slice(0, 8).map((text) => `- ${text}`) : ["- none stated"]),
    "Recent plans (do not repeat these as the farther destination):",
    ...(facts.recentTitles.length ? facts.recentTitles.map((title) => `- ${title}`) : ["- none"]),
    ...(excludeNames.length ? ["Already suggested (pick different places):", ...excludeNames.map((name) => `- ${name}`)] : []),
  ].join("\n");
  return { system, user };
}

async function generate(userId: string, range: TimeOff, excludeNames: string[]): Promise<TripIdea[]> {
  ideaGenerationCalls += 1;
  const facts = await gatherFacts(userId, range);
  let ideas: TripIdea[];
  if (currentAiMode() === "demo") {
    ideas = demoIdeas(excludeNames, facts.recentText);
  } else {
    const { system, user } = buildPrompts(range, facts, excludeNames);
    // Non-fast path: the full model, with the repair retry in callAiJson. Nothing here is a plan row or a job.
    const result = await callAiJson(system, user, buildIdeasSchema(facts.recentText, excludeNames));
    ideas = [
      { name: result.local.name, reason: result.local.reason, scope: "getaway" },
      { name: result.farther.name, reason: result.farther.reason, scope: "vacation" },
    ];
  }
  await saveCachedIdeas(userId, range.id, facts.tasteFingerprint, ideas);
  return ideas;
}

/**
 * The ideas for the nudge when the app opens: cached when fresh (same taste set, under 14 days),
 * otherwise generated once (concurrent opens share one call). Never throws and never holds Home for
 * long: on a failure or a slow model it returns [] and the card offers "Show ideas".
 */
export async function ensureIdeas(userId: string, range: TimeOff): Promise<TripIdea[]> {
  const facts = await gatherFacts(userId, range);
  const cached = await getCachedIdeas(userId, range.id);
  if (cached && cached.ideas.length > 0 && cached.tasteFingerprint === facts.tasteFingerprint && cached.ageDays < IDEAS_MAX_AGE_DAYS) {
    return cached.ideas;
  }
  const key = `${userId}:${range.id}`;
  const failedAt = lastFailure.get(key);
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return [];

  let pending = inflight.get(key);
  if (!pending) {
    pending = generate(userId, range, [])
      .catch((err) => {
        lastFailure.set(key, Date.now());
        logger.warn("Trip idea generation failed; Home continues without ideas", { error: String(err) });
        return [] as TripIdea[];
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  if (currentAiMode() === "demo") return pending;
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<TripIdea[]>((resolve) => {
    timer = setTimeout(() => resolve([]), OPEN_BUDGET_MS);
  });
  try {
    return await Promise.race([pending, budget]);
  } finally {
    clearTimeout(timer);
  }
}

/** "Other ideas": always a fresh generation that avoids the places already shown. Failures surface as 503. */
export async function refreshIdeas(userId: string, range: TimeOff): Promise<TripIdea[]> {
  const cached = await getCachedIdeas(userId, range.id);
  const exclude = (cached?.ideas ?? []).map((idea) => idea.name);
  try {
    const ideas = await generate(userId, range, exclude);
    lastFailure.delete(`${userId}:${range.id}`);
    return ideas;
  } catch (err) {
    logger.warn("Other-ideas generation failed", { error: String(err) });
    throw new HttpError(503, "Couldn't find trip ideas right now. Please try again in a moment.");
  }
}

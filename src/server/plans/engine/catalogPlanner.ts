import type { AiCandidate } from "../../../shared/schemas.js";
import type { GenerateContext } from "../../ai/demoAi.js";
import { hashSeed, mulberry32, seededShuffle } from "../../ai/rng.js";
import type { ResolvedVenue } from "../../resolver/placeResolver.js";
import { blockedTermsForConstraint, containsUnsafeBlockedTerm, indoorOnlyRequired, outdoorOnlyRequired } from "./constraintKeywords.js";
import { clockToMinutes, minutesToClock } from "../../../shared/moment.js";

const EARTH_RADIUS_KM = 6371;
const MAX_WALKING_LEG_KM = 2.4;
const GENERIC_NAMES = /^(?:cafe|café|bar|restaurant|restaurante|snack[- ]?bar|jardim|parque|miradouro)$/i;
const STOP_WORDS = new Set([
  "about", "after", "also", "around", "dinner", "family", "have", "healthy", "little", "meal", "nice",
  "plan", "please", "restaurant", "saturday", "somewhat", "something", "stroll", "their", "then", "there",
  "this", "walk", "want", "weekend", "with",
  // words the moment hint (spec rule 4) puts in the request text; never taste or venue tokens
  "day", "evening", "first", "lunch", "moment", "more", "out", "romantic", "start", "tonight", "two",
]);

interface RouteChoice {
  meal: ResolvedVenue;
  pre: ResolvedVenue;
  post: ResolvedVenue;
  homeDistanceKm: number;
  preToMealKm: number;
  mealToPostKm: number;
  score: number;
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

export function distanceKm(a: Pick<ResolvedVenue, "lat" | "lng">, b: Pick<ResolvedVenue, "lat" | "lng">): number {
  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);
  const sinLat = Math.sin(latDelta / 2);
  const sinLng = Math.sin(lngDelta / 2);
  const h = sinLat * sinLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLng * sinLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function preferenceTokens(ctx: GenerateContext, polarity: "love" | "avoid"): string[] {
  const texts = polarity === "love"
    ? [
        ctx.moodContext,
        ...ctx.loveTastes.map((taste) => taste.text),
        ...(ctx.preferenceHunches ?? []).filter((hunch) => hunch.polarity === "love").map((hunch) => hunch.text),
      ]
    : [
        ...(ctx.avoidTastes ?? []).map((taste) => taste.text),
        ...(ctx.preferenceHunches ?? []).filter((hunch) => hunch.polarity === "avoid").map((hunch) => hunch.text),
      ];
  return Array.from(new Set(normalized(texts.filter(Boolean).join(" ")).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token))));
}

function venueText(venue: ResolvedVenue): string {
  return normalized(`${venue.name} ${venue.subcategory} ${venue.tags.join(" ")}`);
}

function requestedFoodTerms(ctx: GenerateContext): string[] {
  return foodTermsFromText([ctx.moodContext, ...ctx.loveTastes.map((taste) => taste.text)].filter(Boolean).join(" "));
}

function foodTermsFromText(raw: string): string[] {
  const text = normalized(raw);
  const terms = new Set<string>();
  if (/\bfish\b|\bseafood\b/.test(text)) ["fish", "seafood"].forEach((term) => terms.add(term));
  if (/\bmeat\b|\bsteak\b/.test(text)) ["meat", "steak", "barbecue", "chicken"].forEach((term) => terms.add(term));
  if (/\bgrill(?:ed)?\b|\bcharcoal\b|\bchurrasc/.test(text)) ["grill", "barbecue", "steak", "chicken"].forEach((term) => terms.add(term));
  if (/\bvegetarian\b|\bvegan\b/.test(text)) ["vegetarian", "vegan"].forEach((term) => terms.add(term));
  if (/\bjapanese\b|\bsushi\b/.test(text)) ["japanese", "sushi"].forEach((term) => terms.add(term));
  if (/\bindian\b/.test(text)) terms.add("indian");
  if (/\bitalian\b|\bpizza\b/.test(text)) ["italian", "pizza"].forEach((term) => terms.add(term));
  return [...terms];
}

function qualityScore(venue: ResolvedVenue, loves: string[], avoids: string[]): number {
  const text = venueText(venue);
  let score = venue.subcategory === "restaurant" ? 5 : venue.category === "food" ? 1 : 3;
  if (venue.address) score += 2;
  if (venue.tags.length >= 2) score += 2;
  if (venue.tags.some((tag) => ![venue.category, venue.subcategory].includes(tag))) score += 1;
  score += loves.reduce((total, token) => total + (text.includes(token) ? 4 : 0), 0);
  score -= avoids.reduce((total, token) => total + (text.includes(token) ? 10 : 0), 0);
  return score;
}

function distanceBand(seed: number, mood: string, radiusKm: number): [number, number] {
  if (/nearby|close|local|walking distance/i.test(mood)) return [0, Math.min(radiusKm, 8)];
  if (/day trip|escape|outside|farther|further|coast|beach|countryside/i.test(mood)) return [Math.min(12, radiusKm), radiusKm];
  const roll = seed % 10;
  if (roll < 5) return [0, Math.min(radiusKm, 10)];
  if (roll < 8) return [Math.min(8, radiusKm), Math.min(radiusKm, 28)];
  return [Math.min(22, radiusKm), radiusKm];
}

function travelLeg(km: number, transport: "flexible" | "public" | "car"): { travelMode: "walking" | "driving" | "transit"; travelMinutes: number } {
  if (km <= MAX_WALKING_LEG_KM) {
    return { travelMode: "walking", travelMinutes: Math.max(2, Math.round(km / 0.075)) };
  }
  return transport === "public"
    ? { travelMode: "transit", travelMinutes: Math.max(12, Math.round(km * 2.1 + 8)) }
    : { travelMode: "driving", travelMinutes: Math.max(8, Math.round(km * 1.35 + 5)) };
}

function requestedTransport(ctx: GenerateContext): "flexible" | "public" | "car" {
  const match = (ctx.moodContext ?? "").match(/Transport:\s*(flexible|public|car)/i);
  return (match?.[1]?.toLowerCase() as "flexible" | "public" | "car" | undefined) ?? "flexible";
}

function walkingLegLimit(ctx: GenerateContext): number {
  if (/Walking:\s*20-40 minutes/i.test(ctx.moodContext ?? "")) return 1.1;
  if (/Walking:\s*75-120 minutes/i.test(ctx.moodContext ?? "")) return MAX_WALKING_LEG_KM;
  return 1.7;
}

function venuePlace(venue: ResolvedVenue) {
  const descriptor = venue.tags.filter((tag) => tag !== venue.subcategory).slice(0, 3).join(", ");
  return {
    name: venue.name,
    address: venue.address,
    kind: venue.subcategory.replaceAll("_", " "),
    sourceUrl: venue.sourceUrl,
    sourceLabel: "OpenStreetMap",
    factualNote: descriptor
      ? `Mapped as a ${venue.subcategory.replaceAll("_", " ")} with tags for ${descriptor}; verify current operating details before leaving.`
      : `Mapped as a ${venue.subcategory.replaceAll("_", " ")}; verify current operating details before leaving.`,
  };
}

function isIndoorVisit(venue: ResolvedVenue): boolean {
  return venue.category === "activity" && /^(museum|gallery)$/.test(venue.subcategory);
}

const UNWORTHY_STOP_NAME = /(?<![\p{L}])(chafariz|fontan[aá]rio|fonte|fountain|pres[ií]dio|pris[aã]o|prison|cemit[eé]rio|cemetery)(?![\p{L}])/iu;

/** True when the meal (hence the stops after it) falls in the evening, when museums and the like are shut. */
function isEveningOuting(ctx: GenerateContext): boolean {
  const start = clockToMinutes(ctx.moment?.mealStart ?? ctx.moment?.startTime ?? null);
  return start != null && start >= 17 * 60 + 30;
}

/** A stop worth walking to: not a bare fountain, prison fort or cemetery, and nothing that closes before an evening meal. */
export function stopUnsuitable(ctx: GenerateContext, venue: ResolvedVenue): boolean {
  if (UNWORTHY_STOP_NAME.test(venue.name)) return true;
  return venue.category === "activity" && isEveningOuting(ctx);
}

function findRouteChoices(ctx: GenerateContext, venues: ResolvedVenue[]): RouteChoice[] {
  if (ctx.homeBaseLat == null || ctx.homeBaseLng == null) return [];
  const home = { lat: ctx.homeBaseLat, lng: ctx.homeBaseLng };
  const recent = new Set((ctx.recentSuggestions ?? []).flatMap((suggestion) => suggestion.placeNames.map(normalized)));
  const loves = preferenceTokens(ctx, "love");
  const avoids = preferenceTokens(ctx, "avoid");
  const seed = hashSeed(ctx.seed);
  const maxWalkingLegKm = walkingLegLimit(ctx);
  const [bandMin, bandMax] = distanceBand(seed, ctx.moodContext ?? "", ctx.radiusKm);
  const usable = venues.filter((venue) =>
    !recent.has(normalized(venue.name)) && !GENERIC_NAMES.test(venue.name.trim()) && distanceKm(home, venue) <= ctx.radiusKm
  );
  const setting = (ctx.moodContext ?? "").match(/Setting:\s*(mixed|outdoors|indoors)/i)?.[1]?.toLowerCase();
  let nonMealPlaces = usable.filter((venue) => venue.category !== "food" && !stopUnsuitable(ctx, venue));
  if (setting === "outdoors") nonMealPlaces = nonMealPlaces.filter((venue) => venue.category === "outdoor");
  if (setting === "indoors") nonMealPlaces = nonMealPlaces.filter(isIndoorVisit);
  let meals = usable.filter((venue) => venue.category === "food" && venue.subcategory === "restaurant");
  const foodTerms = requestedFoodTerms(ctx);
  const foodMatches = foodTerms.length ? meals.filter((meal) => foodTerms.some((term) => venueText(meal).includes(term))) : [];
  if (foodMatches.length >= 8) meals = foodMatches;
  const inBand = meals.filter((venue) => {
    const distance = distanceKm(home, venue);
    return distance >= bandMin && distance <= bandMax;
  });
  if (inBand.length >= 8) meals = inBand;

  const random = mulberry32(seed);
  const mealPool = seededShuffle(meals, seed)
    .map((meal) => ({ meal, score: qualityScore(meal, loves, avoids) + random() * 2 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 500);
  const choices: RouteChoice[] = [];
  for (const item of mealPool) {
    const nearby = nonMealPlaces
      .map((place) => ({ place, km: distanceKm(place, item.meal) }))
      .filter(({ km }) => km >= 0.08 && km <= maxWalkingLegKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 30);
    if (nearby.length < 2) continue;
    const shuffledNearby = seededShuffle(nearby, seed ^ hashSeed(item.meal.id));
    const pre = shuffledNearby.find(({ place }) => place.subcategory !== "museum") ?? shuffledNearby[0];
    const post = shuffledNearby.find(({ place }) => place.id !== pre.place.id && distanceKm(place, pre.place) >= 0.15);
    if (!post) continue;
    const homeDistanceKm = distanceKm(home, item.meal);
    choices.push({
      meal: item.meal,
      pre: pre.place,
      post: post.place,
      homeDistanceKm,
      preToMealKm: pre.km,
      mealToPostKm: post.km,
      score: item.score + (pre.place.subcategory !== post.place.subcategory ? 1 : 0) - (pre.km + post.km) * 0.12,
    });
  }
  return choices.sort((a, b) => b.score - a.score);
}

export interface CatalogMatch {
  candidate: AiCandidate;
  /** The love taste the planner reports as the reason this route won, or null when none fits. */
  matchedTasteId: string | null;
}

function ceil5(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

/** Deterministic: which stored love taste does the chosen route actually reflect? */
function matchedLoveTaste(ctx: GenerateContext, choice: RouteChoice): string | null {
  const mealText = venueText(choice.meal);
  const stopsText = `${venueText(choice.pre)} ${venueText(choice.post)}`;
  let bestId: string | null = null;
  let bestScore = 0;
  for (const taste of ctx.loveTastes) {
    const tokens = normalized(taste.text).split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
    let score = 0;
    for (const token of tokens) {
      if (mealText.includes(token)) score += 2;
      else if (stopsText.includes(token)) score += 1;
    }
    for (const term of foodTermsFromText(taste.text)) {
      if (mealText.includes(term)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = taste.id;
    }
  }
  return bestId;
}

export function buildCatalogCandidate(ctx: GenerateContext, venues: ResolvedVenue[]): AiCandidate | null {
  return buildCatalogCandidateWithMatch(ctx, venues)?.candidate ?? null;
}

export function buildCatalogCandidateWithMatch(ctx: GenerateContext, venues: ResolvedVenue[]): CatalogMatch | null {
  const choices = findRouteChoices(ctx, venues);
  if (!choices.length) return null;
  const seed = hashSeed(ctx.seed);
  const choice = choices[Math.min(choices.length - 1, seed % Math.min(24, choices.length))];
  return assembleCatalogCandidate(ctx, venues, choice);
}

type StopBeatBuilder = (
  venue: ResolvedVenue,
  role: "pre" | "early" | "post",
  startTime: string,
  durationMinutes: number,
  leg: ReturnType<typeof travelLeg>,
  legKm: number
) => AiCandidate["beats"][number];

/** How many beats a plan should have: shaped by how much time it covers, not fixed at three. */
export function targetBeatCount(ctx: GenerateContext): number {
  const kind = ctx.moment?.kind ?? (ctx.scale === "weekend" ? "weekend" : ctx.scale === "day_off" ? "day" : "tonight");
  if (kind === "weekend") return 7;
  if (kind === "day") return 5;
  const start = clockToMinutes(ctx.moment?.startTime ?? null);
  return start !== null && start < 16 * 60 ? 4 : 3;
}

/**
 * Appends extra stops (and, for a day or weekend, a second meal and a second day) to the three-beat
 * core, each chosen from the real catalogue within walking distance of the previous one. Mutates
 * `beats`; returns the added venues and their leg lengths.
 */
function extendRoute(
  ctx: GenerateContext,
  venues: ResolvedVenue[],
  choice: RouteChoice,
  beats: AiCandidate["beats"],
  transport: "flexible" | "public" | "car",
  stopBeat: StopBeatBuilder,
  mealDescription: string
): { venues: ResolvedVenue[]; legKm: number[] } {
  const added: ResolvedVenue[] = [];
  const legKm: number[] = [];
  const target = targetBeatCount(ctx);
  if (target <= beats.length || ctx.homeBaseLat == null || ctx.homeBaseLng == null) return { venues: added, legKm };
  const kind = ctx.moment?.kind ?? (ctx.scale === "weekend" ? "weekend" : "day");
  const home = { lat: ctx.homeBaseLat, lng: ctx.homeBaseLng };
  const recent = recentNameSet(ctx);
  const seed = hashSeed(ctx.seed);
  const maxLegKm = Math.min(walkingLegLimit(ctx), 3);
  const loves = preferenceTokens(ctx, "love");
  const avoids = preferenceTokens(ctx, "avoid");
  const used = new Set([choice.pre.id, choice.meal.id, choice.post.id]);
  const usable = venues.filter((venue) => isUsableName(venue, recent) && distanceKm(home, venue) <= ctx.radiusKm && !violatesConstraints(ctx, venue));
  const stopPool = usable.filter((venue) => venue.category !== "food" && settingAllowsStop(ctx, venue) && !stopUnsuitable(ctx, venue));
  const mealPool = usable.filter((venue) => venue.category === "food" && venue.subcategory === "restaurant");

  const nextNear = (from: ResolvedVenue, pool: ResolvedVenue[], minKm: number): { venue: ResolvedVenue; km: number } | null => {
    const near = pool
      .filter((venue) => !used.has(venue.id))
      .map((venue) => ({ venue, km: distanceKm(from, venue) }))
      .filter(({ km }) => km >= minKm && km <= maxLegKm)
      .sort((a, b) => qualityScore(b.venue, loves, avoids) - qualityScore(a.venue, loves, avoids) || a.km - b.km)
      .slice(0, 6);
    if (!near.length) return null;
    return seededShuffle(near, seed ^ hashSeed(from.id))[0];
  };

  const last = beats[beats.length - 1];
  let cursor = (clockToMinutes(last.startTime ?? null) ?? 14 * 60) + (last.durationMinutes ?? 30);
  let from = choice.post;
  let sundayStarted = false;
  const sequence: Array<"stop" | "meal" | "sunday-stop" | "sunday-meal"> =
    kind === "weekend" ? ["stop", "sunday-stop", "sunday-meal", "sunday-stop"]
    : kind === "day" ? ["stop", "meal"]
    : ["stop"];
  for (const role of sequence) {
    if (beats.length >= target) break;
    const sunday = role.startsWith("sunday");
    const isMeal = role.endsWith("meal");
    const sundayOpening = sunday && !sundayStarted;
    if (sundayOpening) { cursor = 10 * 60 + 30; sundayStarted = true; from = choice.meal; }
    const found = nextNear(from, isMeal ? mealPool : stopPool, 0.1);
    if (!found) continue;
    const leg = travelLeg(found.km, transport);
    let start = sundayOpening ? cursor : ceil5(cursor + leg.travelMinutes);
    let beat: AiCandidate["beats"][number];
    if (isMeal) {
      const dinner = !sunday;
      start = dinner ? Math.max(start, 19 * 60) : Math.max(start, 13 * 60);
      beat = {
        title: `${dinner ? "Dinner" : "Lunch"} at ${found.venue.name}`,
        description: mealDescription,
        category: "food",
        indoor: true,
        startTime: minutesToClock(start),
        durationMinutes: 90,
        ...leg,
        distanceFromPreviousKm: Math.round(found.km * 10) / 10,
        place: venuePlace(found.venue),
      };
      cursor = start + 90;
    } else {
      beat = stopBeat(found.venue, "early", minutesToClock(start), 45, leg, found.km);
      cursor = start + 45;
    }
    if (kind === "weekend") beat = { ...beat, title: `${sunday ? "Sunday" : "Saturday"}: ${beat.title}`.slice(0, 120) };
    beats.push(beat);
    used.add(found.venue.id);
    added.push(found.venue);
    legKm.push(found.km);
    from = found.venue;
  }
  if (kind === "weekend") {
    for (let i = 0; i < Math.min(3, beats.length); i += 1) {
      if (!beats[i].title.startsWith("Saturday: ")) beats[i] = { ...beats[i], title: `Saturday: ${beats[i].title}`.slice(0, 120) };
    }
  }
  return { venues: added, legKm };
}

/** Beats, timing and meal-first logic for one explicit route choice; shared by the deterministic and model paths. */
function assembleCatalogCandidate(
  ctx: GenerateContext,
  venues: ResolvedVenue[],
  choice: RouteChoice,
  overrides: { title?: string; rationale?: string } = {}
): CatalogMatch {
  const recentNames = new Set((ctx.recentSuggestions ?? []).flatMap((suggestion) => suggestion.placeNames.map(normalized)));
  const mealAlternatives = venues
    .filter((venue) => venue.category === "food" && venue.subcategory === "restaurant" && venue.id !== choice.meal.id && !recentNames.has(normalized(venue.name)) && distanceKm(venue, choice.meal) <= 2.5)
    .sort((a, b) => distanceKm(a, choice.meal) - distanceKm(b, choice.meal));
  const fallback = mealAlternatives.find((venue) => !GENERIC_NAMES.test(venue.name.trim())) ?? null;
  const request = ctx.moodContext ?? "";
  const wantsLunch = /\blunch|midday|noon\b/i.test(request);
  const wantsDinner = /\bdinner|evening|night\b/i.test(request);
  const times = wantsLunch ? ["11:15", "12:45", "14:25"] : wantsDinner ? ["17:30", "19:00", "20:50"] : ["11:30", "13:00", "14:40"];
  const transport = requestedTransport(ctx);
  const homePoint = { lat: ctx.homeBaseLat!, lng: ctx.homeBaseLng! } as ResolvedVenue;
  const firstLeg = travelLeg(distanceKm(homePoint, choice.pre), transport);
  const mealLeg = travelLeg(choice.preToMealKm, transport);
  const postLeg = travelLeg(choice.mealToPostKm, transport);
  const hasPet = (ctx.participants ?? []).some((participant) => participant.kind === "pet");
  const moment = ctx.moment && ctx.moment.kind !== "weekend" && ctx.moment.startTime ? ctx.moment : null;
  const mealDescription = "Make this the anchor meal, confirming the current menu and any dietary needs directly with the restaurant.";

  const stopBeat = (
    venue: ResolvedVenue,
    role: "pre" | "early" | "post",
    startTime: string,
    durationMinutes: number,
    leg: ReturnType<typeof travelLeg>,
    legKm: number
  ): AiCandidate["beats"][number] => {
    const indoor = isIndoorVisit(venue);
    const title = role === "pre"
      ? `Start gently at ${venue.name}`
      : role === "early"
        ? `${indoor ? "Easy visit" : "Easy stroll"} at ${venue.name}`
        : `${indoor ? "Easy finish" : "Soft finish"} at ${venue.name}`;
    const description = role === "pre"
      ? "Take an easy, flexible loop before the meal; turn back early if the group has had enough."
      : role === "early"
        ? "After the meal, take an easy, unhurried look around nearby; leave whenever the group is ready."
        : indoor
          ? "Finish with an unhurried nearby visit, leaving whenever the group is ready."
          : "Finish with a low-pressure stroll or pause nearby, with an easy turn-back whenever you are ready.";
    return {
      title,
      description,
      category: indoor ? "activity" : role === "pre" ? "walk" : "stroll",
      indoor,
      startTime,
      durationMinutes,
      ...leg,
      distanceFromPreviousKm: Math.round(legKm * 10) / 10,
      place: venuePlace(venue),
    };
  };

  let beats: AiCandidate["beats"];
  let titleOrder: string[];
  if (moment?.mealFirst) {
    // Meal first (spec rule 4): the meal, then the two nearby stops, nearest first.
    const mealStartMinutes = clockToMinutes(moment.mealStart ?? moment.startTime) ?? 19 * 60;
    const [near, far] = [
      { venue: choice.pre, km: choice.preToMealKm },
      { venue: choice.post, km: choice.mealToPostKm },
    ].sort((a, b) => a.km - b.km);
    const betweenKm = distanceKm(near.venue, far.venue);
    const legMeal = travelLeg(choice.homeDistanceKm, transport);
    const legNear = travelLeg(near.km, transport);
    const legFar = travelLeg(betweenKm, transport);
    const nearStart = ceil5(mealStartMinutes + 90 + legNear.travelMinutes);
    const farStart = ceil5(nearStart + 35 + legFar.travelMinutes);
    beats = [
      {
        title: `Meal at ${choice.meal.name}`,
        description: mealDescription,
        category: "food",
        indoor: true,
        startTime: minutesToClock(mealStartMinutes),
        durationMinutes: 90,
        ...legMeal,
        distanceFromPreviousKm: Math.round(choice.homeDistanceKm * 10) / 10,
        place: venuePlace(choice.meal),
      },
      stopBeat(near.venue, "early", minutesToClock(nearStart), 35, legNear, near.km),
      stopBeat(far.venue, "post", minutesToClock(farStart), 25, legFar, betweenKm),
    ];
    titleOrder = [choice.meal.name, near.venue.name, far.venue.name];
  } else if (moment) {
    // Meal second: the first stop is lengthened so the meal lands in its window.
    const startMinutes = clockToMinutes(moment.startTime) ?? 16 * 60 + 30;
    const mealStartMinutes = clockToMinutes(moment.mealStart) ?? startMinutes + 35;
    const postStart = ceil5(mealStartMinutes + 90 + postLeg.travelMinutes);
    beats = [
      stopBeat(
        choice.pre,
        "pre",
        minutesToClock(startMinutes),
        Math.max(5, Math.min(1440, moment.firstStopMinutes ?? mealStartMinutes - startMinutes)),
        firstLeg,
        distanceKm(homePoint, choice.pre)
      ),
      {
        title: `Meal at ${choice.meal.name}`,
        description: mealDescription,
        category: "food",
        indoor: true,
        startTime: minutesToClock(mealStartMinutes),
        durationMinutes: 90,
        ...mealLeg,
        distanceFromPreviousKm: Math.round(choice.preToMealKm * 10) / 10,
        place: venuePlace(choice.meal),
      },
      stopBeat(choice.post, "post", minutesToClock(postStart), 25, postLeg, choice.mealToPostKm),
    ];
    titleOrder = [choice.pre.name, choice.meal.name, choice.post.name];
  } else {
    beats = [
      {
        title: `Start gently at ${choice.pre.name}`,
        description: "Take an easy, flexible loop before the meal; turn back early if the group has had enough.",
        category: isIndoorVisit(choice.pre) ? "activity" : "walk",
        indoor: isIndoorVisit(choice.pre),
        startTime: times[0],
        durationMinutes: 35,
        ...firstLeg,
        distanceFromPreviousKm: Math.round(distanceKm(homePoint, choice.pre) * 10) / 10,
        place: venuePlace(choice.pre),
      },
      {
        title: `Meal at ${choice.meal.name}`,
        description: mealDescription,
        category: "food",
        indoor: true,
        startTime: times[1],
        durationMinutes: 90,
        ...mealLeg,
        distanceFromPreviousKm: Math.round(choice.preToMealKm * 10) / 10,
        place: venuePlace(choice.meal),
      },
      {
        title: `${isIndoorVisit(choice.post) ? "Easy finish" : "Soft finish"} at ${choice.post.name}`,
        description: isIndoorVisit(choice.post)
          ? "Finish with an unhurried nearby visit, leaving whenever the group is ready."
          : "Finish with a low-pressure stroll or pause nearby, with an easy turn-back whenever you are ready.",
        category: isIndoorVisit(choice.post) ? "activity" : "stroll",
        indoor: isIndoorVisit(choice.post),
        startTime: times[2],
        durationMinutes: 25,
        ...postLeg,
        distanceFromPreviousKm: Math.round(choice.mealToPostKm * 10) / 10,
        place: venuePlace(choice.post),
      },
    ];
    titleOrder = [choice.pre.name, choice.meal.name, choice.post.name];
  }

  const extra = extendRoute(ctx, venues, choice, beats, transport, stopBeat, mealDescription);
  const extraVenueIds = extra.venues.map((venue) => venue.id);
  const extraKm = extra.venues.reduce((sum, _venue, i) => sum + extra.legKm[i], 0);
  const baseTitle = `${titleOrder[0]}, ${titleOrder[1]}, and ${titleOrder[2]}`;
  const title = overrides.title ?? (extra.venues.length ? `${baseTitle} + ${extra.venues.length} more`.slice(0, 120) : baseTitle.slice(0, 120));
  const routeSentence = `fresh, geographically compact route selected from ${venues.length.toLocaleString("en-US")} mapped places within your search area, with the meal and both stops kept close together.`;
  const candidate: AiCandidate = {
    title,
    rationale: overrides.rationale ?? (moment?.romantic
      ? `A romantic evening on a ${routeSentence}`
      : `A ${routeSentence}`),
    category: "food",
    indoor: false,
    beats,
    walkingDistanceKm: Math.round((choice.preToMealKm + choice.mealToPostKm + extraKm + 1.2) * 10) / 10,
    walkingMinutes: Math.round((choice.preToMealKm + choice.mealToPostKm + extraKm) / 0.075) + 60,
    estimatedCost: (() => {
      const cap = request.match(/up to €(25|40|60) per person/i)?.[1];
      return cap ? `Target up to €${cap} per person; confirm against the current menu` : "€20–45 per person; check the current menu";
    })(),
    checkBeforeYouGo: [
      `Confirm ${choice.meal.name}'s opening hours, menu, and reservation availability.`,
      "Verify every dietary requirement directly with the restaurant before ordering.",
      ...(moment?.mealFirst && moment.lateMealFirst
        ? [`This is a late start: confirm ${choice.meal.name} is still serving at ${moment.mealStart ?? moment.startTime}.`]
        : []),
      ...(hasPet ? [`Confirm that ${choice.meal.name} can seat your Pom, ideally on the terrace.`] : []),
    ],
    fallback: fallback
      ? {
          title: `Nearby meal fallback: ${fallback.name}`,
          description: `A mapped restaurant ${distanceKm(fallback, choice.meal).toFixed(1)} km from the original meal stop; verify hours and suitability before switching.`,
          place: venuePlace(fallback),
        }
      : null,
    photoSearchTerm: `${choice.pre.name} Portugal`,
    destinationAnchor: choice.meal.name,
    resolverVenueIds: [choice.pre.id, choice.meal.id, choice.post.id, ...extraVenueIds, ...(fallback ? [fallback.id] : [])],
    citations: [],
    constraintCompliance: ctx.activeConstraints.map((constraint) => ({ constraintId: constraint.id, satisfied: true })),
    travelEstimateKm: Math.round(choice.homeDistanceKm * 10) / 10,
  };
  return { candidate, matchedTasteId: matchedLoveTaste(ctx, choice) };
}

// ---------------------------------------------------------------------------------------------
// Model-assisted route choice. The catalogue stays the ONLY source of venues: the server builds a
// shortlist, the model picks ids from it, and buildCandidateFromPicks re-validates every id.
// ---------------------------------------------------------------------------------------------

export interface ShortlistStop {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  /** Distance from the restaurant. */
  distanceKm: number;
  /** Distance from home. */
  homeKm: number;
}

export interface ShortlistMeal {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  homeKm: number;
  stops: ShortlistStop[];
}

export interface CatalogShortlist {
  meals: ShortlistMeal[];
}

export interface RoutePicks {
  mealId: string;
  firstStopId: string;
  secondStopId: string;
}

const SHORTLIST_MEALS = 20;
const SHORTLIST_STOPS = 6;
const MAX_STOPS_PER_KIND = 3;
const MIN_STOP_GAP_KM = 0.15;
const MIN_STOP_TO_MEAL_KM = 0.08;

function recentNameSet(ctx: GenerateContext): Set<string> {
  return new Set((ctx.recentSuggestions ?? []).flatMap((suggestion) => suggestion.placeNames.map(normalized)));
}

function violatesConstraints(ctx: GenerateContext, venue: ResolvedVenue): boolean {
  const text = venueText(venue);
  return ctx.activeConstraints.some((constraint) => {
    if (blockedTermsForConstraint(constraint.text).some((term) => containsUnsafeBlockedTerm(text, term))) return true;
    if (venue.category !== "food" && indoorOnlyRequired(constraint.text) && !isIndoorVisit(venue)) return true;
    if (venue.category !== "food" && outdoorOnlyRequired(constraint.text) && venue.category !== "outdoor") return true;
    return false;
  });
}

function settingAllowsStop(ctx: GenerateContext, venue: ResolvedVenue): boolean {
  const setting = (ctx.moodContext ?? "").match(/Setting:\s*(mixed|outdoors|indoors)/i)?.[1]?.toLowerCase();
  if (setting === "outdoors") return venue.category === "outdoor";
  if (setting === "indoors") return isIndoorVisit(venue);
  return true;
}

function isUsableName(venue: ResolvedVenue, recent: Set<string>): boolean {
  return !recent.has(normalized(venue.name)) && !GENERIC_NAMES.test(venue.name.trim());
}

function roundKm(km: number): number {
  return Math.round(km * 100) / 100;
}

/** ~20 restaurant candidates, each with ~6 varied nearby non-food stops, for the model to choose from. */
export function buildCatalogShortlist(ctx: GenerateContext, venues: ResolvedVenue[]): CatalogShortlist {
  if (ctx.homeBaseLat == null || ctx.homeBaseLng == null) return { meals: [] };
  const home = { lat: ctx.homeBaseLat, lng: ctx.homeBaseLng };
  const recent = recentNameSet(ctx);
  const loves = preferenceTokens(ctx, "love");
  const avoids = preferenceTokens(ctx, "avoid");
  const seed = hashSeed(ctx.seed);
  const maxLegKm = walkingLegLimit(ctx);
  const [bandMin, bandMax] = distanceBand(seed, ctx.moodContext ?? "", ctx.radiusKm);
  const usable = venues.filter((venue) => isUsableName(venue, recent) && distanceKm(home, venue) <= ctx.radiusKm && !violatesConstraints(ctx, venue));
  const stopPool = usable.filter((venue) => venue.category !== "food" && settingAllowsStop(ctx, venue) && !stopUnsuitable(ctx, venue));
  let meals = usable.filter((venue) => venue.category === "food" && venue.subcategory === "restaurant");
  const foodTerms = requestedFoodTerms(ctx);
  const foodMatches = foodTerms.length ? meals.filter((meal) => foodTerms.some((term) => venueText(meal).includes(term))) : [];
  if (foodMatches.length >= 8) meals = foodMatches;
  // How far is the user's own setting (ctx.radiusKm, already applied above); closeness is only a mild
  // preference so a short trip wins ties but never overrides what the user allowed.
  const random = mulberry32(seed);
  const scored = seededShuffle(meals, seed)
    .map((meal) => {
      const homeKm = distanceKm(home, meal);
      const text = venueText(meal);
      let score = qualityScore(meal, loves, avoids) + random() * 2;
      if (foodTerms.some((term) => text.includes(term))) score += 6;
      if (homeKm >= bandMin && homeKm <= bandMax) score += 3;
      score += (1 - Math.min(1, homeKm / Math.max(1, ctx.radiusKm))) * 5;
      return { meal, homeKm, score };
    })
    .sort((a, b) => b.score - a.score);

  const out: ShortlistMeal[] = [];
  for (const { meal, homeKm } of scored) {
    if (out.length >= SHORTLIST_MEALS) break;
    const nearby = stopPool
      .map((place) => ({ place, km: distanceKm(place, meal) }))
      .filter(({ km }) => km >= MIN_STOP_TO_MEAL_KM && km <= maxLegKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 24)
      .map((item) => ({ ...item, q: qualityScore(item.place, loves, avoids) }))
      .sort((a, b) => b.q - a.q || a.km - b.km);
    const perKind = new Map<string, number>();
    const stops: ShortlistStop[] = [];
    for (const { place, km } of nearby) {
      if (stops.length >= SHORTLIST_STOPS) break;
      const used = perKind.get(place.subcategory) ?? 0;
      if (used >= MAX_STOPS_PER_KIND) continue;
      perKind.set(place.subcategory, used + 1);
      stops.push({
        id: place.id,
        name: place.name,
        kind: place.subcategory.replaceAll("_", " "),
        tags: place.tags.filter((tag) => tag !== place.subcategory).slice(0, 4),
        distanceKm: roundKm(km),
        homeKm: roundKm(distanceKm(home, place)),
      });
    }
    if (stops.length < 2) continue;
    out.push({
      id: meal.id,
      name: meal.name,
      kind: meal.subcategory.replaceAll("_", " "),
      tags: meal.tags.filter((tag) => tag !== meal.subcategory).slice(0, 5),
      homeKm: roundKm(homeKm),
      stops,
    });
  }
  return { meals: out };
}

/**
 * Validates a model's picks against the real catalogue and assembles the candidate; null when any
 * check fails (unknown id, wrong kind, too far to walk, recent, generic, constraint-violating).
 */
export function buildCandidateFromPicks(
  ctx: GenerateContext,
  venues: ResolvedVenue[],
  picks: RoutePicks,
  overrides: { title?: string; rationale?: string } = {}
): CatalogMatch | null {
  if (ctx.homeBaseLat == null || ctx.homeBaseLng == null) return null;
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const meal = byId.get(picks.mealId);
  const pre = byId.get(picks.firstStopId);
  const post = byId.get(picks.secondStopId);
  if (!meal || !pre || !post) return null;
  if (new Set([meal.id, pre.id, post.id]).size !== 3) return null;
  if (meal.category !== "food" || meal.subcategory !== "restaurant") return null;
  if (pre.category === "food" || post.category === "food") return null;
  const home = { lat: ctx.homeBaseLat, lng: ctx.homeBaseLng };
  const recent = recentNameSet(ctx);
  for (const venue of [meal, pre, post]) {
    if (!isUsableName(venue, recent) || violatesConstraints(ctx, venue)) return null;
  }
  if (!settingAllowsStop(ctx, pre) || !settingAllowsStop(ctx, post)) return null;
  if (stopUnsuitable(ctx, pre) || stopUnsuitable(ctx, post)) return null;
  const homeDistanceKm = distanceKm(home, meal);
  if (homeDistanceKm > ctx.radiusKm) return null;
  const maxLegKm = walkingLegLimit(ctx);
  const preToMealKm = distanceKm(pre, meal);
  const mealToPostKm = distanceKm(meal, post);
  if (preToMealKm > maxLegKm || mealToPostKm > maxLegKm) return null;
  if (preToMealKm < MIN_STOP_TO_MEAL_KM || mealToPostKm < MIN_STOP_TO_MEAL_KM) return null;
  if (distanceKm(pre, post) < MIN_STOP_GAP_KM) return null;
  const choice: RouteChoice = { meal, pre, post, homeDistanceKm, preToMealKm, mealToPostKm, score: 0 };
  return assembleCatalogCandidate(ctx, venues, choice, overrides);
}

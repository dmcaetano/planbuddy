import type { AiCandidate } from "../../../shared/schemas.js";
import type { GenerateContext } from "../../ai/demoAi.js";
import { hashSeed, mulberry32, seededShuffle } from "../../ai/rng.js";
import type { ResolvedVenue } from "../../resolver/placeResolver.js";

const EARTH_RADIUS_KM = 6371;
const MAX_WALKING_LEG_KM = 2.4;
const GENERIC_NAMES = /^(?:cafe|café|bar|restaurant|restaurante|snack[- ]?bar|jardim|parque|miradouro)$/i;
const STOP_WORDS = new Set([
  "about", "after", "also", "around", "dinner", "family", "have", "healthy", "little", "meal", "nice",
  "plan", "please", "restaurant", "saturday", "somewhat", "something", "stroll", "their", "then", "there",
  "this", "walk", "want", "weekend", "with",
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
  const text = normalized([ctx.moodContext, ...ctx.loveTastes.map((taste) => taste.text)].filter(Boolean).join(" "));
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
  let nonMealPlaces = usable.filter((venue) => venue.category !== "food");
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

export function buildCatalogCandidate(ctx: GenerateContext, venues: ResolvedVenue[]): AiCandidate | null {
  const choices = findRouteChoices(ctx, venues);
  if (!choices.length) return null;
  const seed = hashSeed(ctx.seed);
  const choice = choices[Math.min(choices.length - 1, seed % Math.min(24, choices.length))];
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
  const firstLeg = travelLeg(distanceKm({ lat: ctx.homeBaseLat!, lng: ctx.homeBaseLng! } as ResolvedVenue, choice.pre), transport);
  const mealLeg = travelLeg(choice.preToMealKm, transport);
  const postLeg = travelLeg(choice.mealToPostKm, transport);
  const hasPet = (ctx.participants ?? []).some((participant) => participant.kind === "pet");
  const beats: AiCandidate["beats"] = [
    {
      title: `Start gently at ${choice.pre.name}`,
      description: "Take an easy, flexible loop before the meal; turn back early if the group has had enough.",
      category: isIndoorVisit(choice.pre) ? "activity" : "walk",
      indoor: isIndoorVisit(choice.pre),
      startTime: times[0],
      durationMinutes: 35,
      ...firstLeg,
      distanceFromPreviousKm: Math.round(distanceKm({ lat: ctx.homeBaseLat!, lng: ctx.homeBaseLng! } as ResolvedVenue, choice.pre) * 10) / 10,
      place: venuePlace(choice.pre),
    },
    {
      title: `Meal at ${choice.meal.name}`,
      description: "Make this the anchor meal, confirming the current menu and any dietary needs directly with the restaurant.",
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
  const title = `${choice.pre.name}, ${choice.meal.name}, and ${choice.post.name}`.slice(0, 120);
  return {
    title,
    rationale: `A fresh, geographically compact route selected from ${venues.length.toLocaleString("en-US")} mapped places within your search area, with the meal and both stops kept close together.`,
    category: "food",
    indoor: false,
    beats,
    walkingDistanceKm: Math.round((choice.preToMealKm + choice.mealToPostKm + 1.2) * 10) / 10,
    walkingMinutes: Math.round((choice.preToMealKm + choice.mealToPostKm) / 0.075) + 60,
    estimatedCost: (() => {
      const cap = request.match(/up to €(25|40|60) per person/i)?.[1];
      return cap ? `Target up to €${cap} per person; confirm against the current menu` : "€20–45 per person; check the current menu";
    })(),
    checkBeforeYouGo: [
      `Confirm ${choice.meal.name}'s opening hours, menu, and reservation availability.`,
      "Verify every dietary requirement directly with the restaurant before ordering.",
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
    resolverVenueIds: [choice.pre.id, choice.meal.id, choice.post.id, ...(fallback ? [fallback.id] : [])],
    citations: [],
    constraintCompliance: ctx.activeConstraints.map((constraint) => ({ constraintId: constraint.id, satisfied: true })),
    travelEstimateKm: Math.round(choice.homeDistanceKm * 10) / 10,
  };
}

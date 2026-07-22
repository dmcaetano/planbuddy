import type {
  AiCandidate,
  AiChatResponse,
  AiFeedbackResponse,
  AiGenerateResponse,
  AiPlaceResearchResponse,
} from "../../shared/schemas.js";
import type { WeatherSnapshot } from "../../shared/types.js";
import { isTripScale, type Scale } from "../../shared/scale.js";
import { LOCAL_TEMPLATES, TRIP_TEMPLATES } from "./contentPool.js";
import { hashSeed, mulberry32, seededShuffle } from "./rng.js";
import { blockedTermsForConstraint } from "../plans/engine/constraintKeywords.js";

export interface MemoryFact {
  id: string;
  text: string;
  source: "taste" | "constraint";
  tags?: string[];
}

export interface GenerateContext {
  scale: Scale;
  startDate?: string;
  endDate?: string;
  homeBaseLabel?: string | null;
  homeBaseLat?: number | null;
  homeBaseLng?: number | null;
  participants?: { name: string; kind: "person" | "pet"; relationship: string | null }[];
  weather?: WeatherSnapshot;
  moodContext: string | null;
  radiusKm: number;
  activeConstraints: { id: string; text: string }[];
  loveTastes: MemoryFact[];
  avoidTastes?: MemoryFact[];
  preferenceHunches?: { text: string; polarity: "love" | "avoid"; confidence: number }[];
  recentSuggestions?: { title: string; category: string; placeNames: string[] }[];
  groundedPlaces?: AiPlaceResearchResponse["places"];
  seed: string; // unique per (planSpecId, batchIndex) for determinism
  edit?: {
    request: string;
    mode: "restaurant" | "meal_time" | "budget" | "walking" | "general";
    originalPlan: {
      title: string;
      category: string;
      estimatedCost: string | null;
      walkingMinutes: number | null;
      beats: Array<{
        title: string;
        category: string;
        startTime: string | null;
        durationMinutes: number | null;
        place: { name: string; address?: string | null; kind: string; sourceUrl: string; sourceLabel: string; factualNote: string } | null;
      }>;
    };
  };
}

function candidateText(c: Pick<AiCandidate, "title" | "rationale" | "category"> & { beats: { title: string; description: string }[] }): string {
  return [c.title, c.rationale, c.category, ...c.beats.map((b) => `${b.title} ${b.description}`)]
    .join(" ")
    .toLowerCase();
}

function selfReportCompliance(
  text: string,
  constraints: { id: string; text: string }[]
): { constraintId: string; satisfied: boolean }[] {
  return constraints.map((c) => {
    const blocked = blockedTermsForConstraint(c.text);
    const satisfied = !blocked.some((term) => text.includes(term));
    return { constraintId: c.id, satisfied };
  });
}

function mapsSource(name: string, city: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${name}, ${city}`);
  return url.toString();
}

const LISBON_QUICK_ROUTES = [
  {
    title: "Estrela garden, grilled fish, and a soft square stroll",
    tags: ["fish", "grilled", "garden", "quiet", "soft", "pom"],
    pre: ["Jardim da Estrela", "Praça da Estrela, Lisboa", "garden", "A relaxed loop under mature trees before dinner."],
    meal: ["Peixaria da Esquina", "Rua Correia Teles 56, Lisboa", "fish restaurant", "A well-known Campo de Ourique fish restaurant; confirm today's grilled options on the live menu."],
    post: ["Jardim Teófilo de Braga", "Praça de São João Bosco, Lisboa", "garden square", "A compact neighborhood square for an easy post-meal loop."],
    cost: "€30–45 per person",
  },
  {
    title: "Necessidades greenery, charcoal grill, and the Alcântara waterfront",
    tags: ["fish", "meat", "grilled", "park", "waterfront", "pom"],
    pre: ["Tapada das Necessidades", "Calçada das Necessidades, Lisboa", "park", "A gentle park walk with room to shorten the loop whenever you like."],
    meal: ["Último Porto", "Estação Marítima da Rocha Conde de Óbidos, Lisboa", "grill restaurant", "An established charcoal-grill stop; confirm today's fish or meat, terrace, and access before leaving."],
    post: ["Doca de Santo Amaro", "Doca de Santo Amaro, Lisboa", "waterfront promenade", "A flat Tagus-side stroll to finish without turning the evening into a hike."],
    cost: "€25–40 per person",
  },
  {
    title: "Torel viewpoint, classic grilled chicken, and an evening miradouro",
    tags: ["meat", "chicken", "grilled", "viewpoint", "classic", "central"],
    pre: ["Jardim do Torel", "Rua Júlio de Andrade, Lisboa", "garden viewpoint", "A short viewpoint loop before the meal, with benches if you want to pause."],
    meal: ["Bonjardim", "Travessa de Santo Antão 11, Lisboa", "Portuguese grill", "A long-running central grill known for chicken; verify the current menu and table setup."],
    post: ["Miradouro de São Pedro de Alcântara", "Rua de São Pedro de Alcântara, Lisboa", "viewpoint", "A flexible post-meal viewpoint stroll with an easy turn-back option."],
    cost: "€20–35 per person",
  },
] as const;

function lisbonQuickCandidate(ctx: GenerateContext): AiGenerateResponse | null {
  if (isTripScale(ctx.scale) || !/lisbo[an]|lisbon/i.test(ctx.homeBaseLabel ?? "")) return null;
  const recentNames = new Set(
    (ctx.recentSuggestions ?? []).flatMap((suggestion) => suggestion.placeNames.map((name) => name.toLowerCase()))
  );
  const unusedRoutes = LISBON_QUICK_ROUTES.filter((item) =>
    [item.pre[0], item.meal[0], item.post[0]].every((name) => !recentNames.has(name.toLowerCase()))
  );
  const positiveText = [
    ctx.moodContext,
    ...ctx.loveTastes.map((taste) => taste.text),
    ...(ctx.preferenceHunches ?? []).filter((hunch) => hunch.polarity === "love").map((hunch) => hunch.text),
  ].filter(Boolean).join(" ").toLowerCase();
  const negativeText = [
    ...(ctx.avoidTastes ?? []).map((taste) => taste.text),
    ...(ctx.preferenceHunches ?? []).filter((hunch) => hunch.polarity === "avoid").map((hunch) => hunch.text),
  ].join(" ").toLowerCase();
  const routePool = unusedRoutes.length > 0 ? unusedRoutes : [...LISBON_QUICK_ROUTES];
  const route = routePool
    .map((item, index) => ({
      item,
      index,
      score: item.tags.reduce(
        (score, tag) => score + (positiveText.includes(tag) ? 2 : 0) - (negativeText.includes(tag) ? 3 : 0),
        0
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].item;
  const place = (data: readonly [string, string, string, string]) => ({
    name: data[0],
    address: data[1],
    kind: data[2],
    sourceUrl: mapsSource(data[0], "Lisbon"),
    sourceLabel: "Google Maps",
    factualNote: data[3],
  });
  const hasPet = (ctx.participants ?? []).some((participant) => participant.kind === "pet");
  const beats: AiCandidate["beats"] = [
    {
      title: `Gentle loop at ${route.pre[0]}`,
      description: route.pre[3],
      category: "walk",
      indoor: false,
      startTime: "17:30",
      durationMinutes: 30,
      travelMode: "walking",
      distanceFromPreviousKm: 1.2,
      travelMinutes: 18,
      place: place(route.pre),
    },
    {
      title: `Grilled dinner at ${route.meal[0]}`,
      description: `${route.meal[3]} Ask the kitchen directly about any dietary constraint rather than relying on a listing.`,
      category: "food",
      indoor: true,
      startTime: "19:00",
      durationMinutes: 90,
      travelMode: "walking",
      distanceFromPreviousKm: 1.1,
      travelMinutes: 17,
      place: place(route.meal),
    },
    {
      title: `Soft finish at ${route.post[0]}`,
      description: route.post[3],
      category: "stroll",
      indoor: false,
      startTime: "20:50",
      durationMinutes: 25,
      travelMode: "walking",
      distanceFromPreviousKm: 0.9,
      travelMinutes: 14,
      place: place(route.post),
    },
  ];
  const candidate: AiCandidate = {
    title: route.title,
    rationale: "A compact Lisbon evening with a real pre-meal walk, a proper grilled meal, and a deliberately soft finish.",
    category: "food",
    indoor: false,
    beats,
    walkingDistanceKm: 3.2,
    walkingMinutes: 74,
    estimatedCost: route.cost,
    checkBeforeYouGo: [
      `Open ${route.meal[0]} in Maps and confirm Saturday hours and reserve a table.`,
      "Ask the restaurant directly about the current menu and every dietary constraint.",
      ...(hasPet ? ["Confirm that the restaurant can seat your Pom; bring a carrier or sling as a tiredness backup."] : []),
    ],
    fallback: null,
    photoSearchTerm: `${route.pre[0]} Lisbon`,
    destinationAnchor: null,
    resolverVenueIds: [],
    citations: [],
    constraintCompliance: selfReportCompliance(candidateText({ title: route.title, rationale: route.pre[3], category: "food", beats }), ctx.activeConstraints),
    travelEstimateKm: 6,
  };
  return { candidates: [candidate] };
}

export function generateCandidatesDemo(ctx: GenerateContext): AiGenerateResponse {
  const seed = hashSeed(ctx.seed);
  const rand = mulberry32(seed);
  const mood = (ctx.moodContext ?? "").toLowerCase();
  const loveTags = new Set(ctx.loveTastes.flatMap((t) => t.tags ?? []));

  if (isTripScale(ctx.scale)) {
    const shuffled = seededShuffle(TRIP_TEMPLATES, seed);
    const scored = shuffled
      .map((t) => {
        let bonus = 0;
        if (mood && t.tags.some((tag) => mood.includes(tag))) bonus += 2;
        if (t.tags.some((tag) => loveTags.has(tag))) bonus += 1;
        return { t, bonus };
      })
      .sort((a, b) => b.bonus - a.bonus);
    const chosen = scored.slice(0, Math.min(8, scored.length)).map((s) => s.t);
    const candidates: AiCandidate[] = chosen.map((t) => {
      const beats = t.beats.map((b) => ({ ...b, category: t.category }));
      const text = candidateText({ title: t.title, rationale: t.rationale, category: t.category, beats });
      const citations = ctx.loveTastes
        .filter((f) => t.tags.some((tag) => (f.tags ?? []).includes(tag)))
        .slice(0, 2)
        .map((f) => ({ factId: f.id, quote: f.text, source: f.source }));
      return {
        title: t.title,
        rationale: t.rationale,
        category: t.category,
        indoor: t.indoor,
        beats,
        walkingDistanceKm: null,
        walkingMinutes: null,
        estimatedCost: null,
        checkBeforeYouGo: ["Open the live map and confirm current hours, availability, and booking requirements."],
        fallback: null,
        photoSearchTerm: t.destinationAnchor,
        destinationAnchor: t.destinationAnchor,
        resolverVenueIds: [],
        citations,
        constraintCompliance: selfReportCompliance(text, ctx.activeConstraints),
        travelEstimateKm: Math.round(50 + rand() * Math.max(1, ctx.radiusKm - 50)),
      };
    });
    return { candidates };
  }

  const templatePool = ctx.edit && (ctx.edit.mode === "restaurant" || ctx.edit.mode === "budget")
    ? LOCAL_TEMPLATES.filter((template) => template.category === "food")
    : LOCAL_TEMPLATES;
  const shuffled = seededShuffle(templatePool, seed);
  const scored = shuffled
    .map((t) => {
      let bonus = 0;
      if (mood && t.tags.some((tag) => mood.includes(tag))) bonus += 2;
      if (t.tags.some((tag) => loveTags.has(tag))) bonus += 1;
      return { t, bonus };
    })
    .sort((a, b) => b.bonus - a.bonus);
  const chosen = scored.slice(0, Math.min(8, scored.length)).map((s) => s.t);
  const candidates: AiCandidate[] = chosen.map((t) => {
    const beats = [
      {
        title: "Easy arrival walk",
        description: `Begin with a gentle, flexible walk near ${ctx.homeBaseLabel ?? "home"}.`,
        category: t.category,
        indoor: false,
        startTime: "17:30",
        durationMinutes: 25,
        travelMode: "walking" as const,
        distanceFromPreviousKm: 1,
        travelMinutes: 15,
        place: null,
      },
      {
        ...t.beat,
        category: t.category,
        indoor: t.indoor,
        startTime: "18:15",
        durationMinutes: 75,
        travelMode: "walking" as const,
        distanceFromPreviousKm: 0.8,
        travelMinutes: 12,
        place: null,
      },
      {
        title: "Soft after-plan stroll",
        description: "Finish with an easy loop and turn back whenever the group has had enough.",
        category: "stroll",
        indoor: false,
        startTime: "19:45",
        durationMinutes: 25,
        travelMode: "walking" as const,
        distanceFromPreviousKm: 1.2,
        travelMinutes: 20,
        place: null,
      },
    ];
    const text = candidateText({ title: t.title, rationale: t.rationale, category: t.category, beats });
    const citations = ctx.loveTastes
      .filter((f) => t.tags.some((tag) => (f.tags ?? []).includes(tag)))
      .slice(0, 2)
      .map((f) => ({ factId: f.id, quote: f.text, source: f.source }));
    return {
      title: t.title,
      rationale: t.rationale,
      category: t.category,
      indoor: t.indoor,
      beats,
      walkingDistanceKm: 3,
      walkingMinutes: 47,
      estimatedCost: null,
      checkBeforeYouGo: ["Demo mode cannot verify venues: open Maps and confirm a named place before leaving."],
      fallback: null,
      photoSearchTerm: null,
      destinationAnchor: null,
      resolverVenueIds: [],
      citations,
      constraintCompliance: selfReportCompliance(text, ctx.activeConstraints),
      travelEstimateKm: Math.round(1 + rand() * Math.max(1, ctx.radiusKm)),
    };
  });
  return { candidates };
}

export interface ChatContext {
  message: string;
  seed: string;
}

const CONSTRAINT_PHRASES = [
  { re: /\ballerg(?:y|ic|ies)?\s+to\s+([a-z ]{2,30})/i, kind: "constraint" as const },
  { re: /\bno\s+([a-z ]{2,30})\s+(?:please|ever)?\b/i, kind: "constraint" as const },
  { re: /\bcan'?t\s+(?:eat|do|have)\s+([a-z ]{2,30})/i, kind: "constraint" as const },
];
const TASTE_LOVE_PHRASES = [/\bwe love\s+([a-z ]{2,30})/i, /\b(?:i|we)\s+really\s+like\s+([a-z ]{2,30})/i];
const TASTE_AVOID_PHRASES = [/\b(?:i|we)\s+(?:hate|dislike|don'?t like)\s+([a-z ]{2,30})/i];

/**
 * Production escape hatch for the latency-sensitive one-click path. It uses
 * a concrete Maps-ready Lisbon route when available, while the broader demo
 * generator remains intact for tests, edits, trips, and other cities.
 */
export function generateCuratedQuickPlan(ctx: GenerateContext): AiGenerateResponse | null {
  if (ctx.edit) return null;
  return lisbonQuickCandidate(ctx);
}

export function generateQuickFallback(ctx: GenerateContext): AiGenerateResponse {
  if (!ctx.edit) {
    const quickLisbon = lisbonQuickCandidate(ctx);
    if (quickLisbon) return quickLisbon;
  }
  return generateCandidatesDemo(ctx);
}

export function chatRespondDemo(ctx: ChatContext): AiChatResponse {
  const msg = ctx.message;
  const extractions: AiChatResponse["extractions"] = [];

  for (const phrase of CONSTRAINT_PHRASES) {
    const match = msg.match(phrase.re);
    if (match) {
      const captured = match[1].trim();
      const quote = match[0].trim();
      const idx = msg.indexOf(quote);
      extractions.push({
        participantName: null,
        kind: "constraint",
        text: `No ${captured}`,
        quote,
        quoteStart: idx >= 0 ? idx : null,
        quoteEnd: idx >= 0 ? idx + quote.length : null,
        polarity: null,
        confidence: 0.9,
      });
      break;
    }
  }

  for (const re of TASTE_LOVE_PHRASES) {
    const match = msg.match(re);
    if (match) {
      const captured = match[1].trim();
      const quote = match[0].trim();
      const idx = msg.indexOf(quote);
      extractions.push({
        participantName: null,
        kind: "taste",
        text: captured,
        quote,
        quoteStart: idx >= 0 ? idx : null,
        quoteEnd: idx >= 0 ? idx + quote.length : null,
        polarity: "love",
        confidence: 0.75,
      });
      break;
    }
  }
  for (const re of TASTE_AVOID_PHRASES) {
    const match = msg.match(re);
    if (match) {
      const captured = match[1].trim();
      const quote = match[0].trim();
      const idx = msg.indexOf(quote);
      extractions.push({
        participantName: null,
        kind: "taste",
        text: captured,
        quote,
        quoteStart: idx >= 0 ? idx : null,
        quoteEnd: idx >= 0 ? idx + quote.length : null,
        polarity: "avoid",
        confidence: 0.7,
      });
      break;
    }
  }

  const reply =
    extractions.length > 0
      ? "Got it — I've noted that for your household memory. Want me to fold it into a plan?"
      : "Tell me a bit more about who's involved or what kind of day you're after, and I can turn it into a plan.";

  return { reply, specUpdate: null, extractions };
}

export function feedbackExtractDemo(comment: string): AiFeedbackResponse {
  const text = comment.toLowerCase();
  const evidence: AiFeedbackResponse["evidence"] = [];
  if (/loved|amazing|great pick|perfect/.test(text)) {
    evidence.push({ participantName: null, text: "similar plans to this one", polarity: "love", confidence: 0.6 });
  }
  if (/too (loud|crowded|far|expensive)|didn'?t (like|enjoy)|not a fan/.test(text)) {
    evidence.push({ participantName: null, text: "plans like this one", polarity: "avoid", confidence: 0.6 });
  }
  return { evidence };
}

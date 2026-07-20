import {
  aiGenerateResponseSchema,
  aiPlaceResearchResponseSchema,
  type AiGenerateResponse,
  type AiPlaceResearchResponse,
} from "../../shared/schemas.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { safeJsonParse, type GroundingSource } from "../ai/deepseek.js";
import type { GenerateContext } from "../ai/demoAi.js";
import {
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildPlaceResearchSystemPrompt,
  buildPlaceResearchUserPrompt,
} from "../ai/prompts.js";

const PLACE_JSON_SCHEMA = {
  type: "object",
  properties: {
    places: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: ["string", "null"] },
          kind: { type: "string" },
          sourceUrl: { type: "string" },
          sourceLabel: { type: "string" },
          factualNote: { type: "string" },
          bestFor: { type: "array", items: { type: "string" } },
          photoSearchTerm: { type: ["string", "null"] },
        },
        required: [
          "name",
          "address",
          "kind",
          "sourceUrl",
          "sourceLabel",
          "factualNote",
          "bestFor",
          "photoSearchTerm",
        ],
      },
    },
  },
  required: ["places"],
};

const PLAN_PLACE_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    address: { type: ["string", "null"] },
    kind: { type: "string" },
    sourceUrl: { type: "string" },
    sourceLabel: { type: "string" },
    factualNote: { type: "string" },
  },
  required: ["name", "address", "kind", "sourceUrl", "sourceLabel", "factualNote"],
};

const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 120 },
          rationale: { type: "string", maxLength: 600 },
          category: { type: "string" },
          indoor: { type: "boolean" },
          beats: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                title: { type: "string", maxLength: 120 },
                description: { type: "string", maxLength: 400 },
                category: { type: "string" },
                indoor: { type: "boolean" },
                startTime: { type: ["string", "null"] },
                durationMinutes: { type: ["integer", "null"] },
                travelMode: { type: ["string", "null"], enum: ["walking", "driving", "transit", "ferry", null] },
                distanceFromPreviousKm: { type: ["number", "null"] },
                travelMinutes: { type: ["integer", "null"] },
                place: { ...PLAN_PLACE_JSON_SCHEMA, type: ["object", "null"] },
              },
              required: [
                "title",
                "description",
                "category",
                "indoor",
                "startTime",
                "durationMinutes",
                "travelMode",
                "distanceFromPreviousKm",
                "travelMinutes",
                "place",
              ],
            },
          },
          walkingDistanceKm: { type: ["number", "null"] },
          walkingMinutes: { type: ["integer", "null"] },
          estimatedCost: { type: ["string", "null"] },
          checkBeforeYouGo: { type: "array", items: { type: "string" } },
          fallback: {
            type: ["object", "null"],
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              place: { ...PLAN_PLACE_JSON_SCHEMA, type: ["object", "null"] },
            },
            required: ["title", "description", "place"],
          },
          photoSearchTerm: { type: ["string", "null"] },
          destinationAnchor: { type: ["string", "null"] },
          resolverVenueIds: { type: "array", items: { type: "string" } },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                factId: { type: "string" },
                quote: { type: "string" },
                source: { type: "string" },
              },
              required: ["factId", "quote", "source"],
            },
          },
          constraintCompliance: {
            type: "array",
            items: {
              type: "object",
              properties: {
                constraintId: { type: "string" },
                satisfied: { type: "boolean" },
              },
              required: ["constraintId", "satisfied"],
            },
          },
          travelEstimateKm: { type: ["number", "null"] },
        },
        required: [
          "title",
          "rationale",
          "category",
          "indoor",
          "beats",
          "walkingDistanceKm",
          "walkingMinutes",
          "estimatedCost",
          "checkBeforeYouGo",
          "fallback",
          "photoSearchTerm",
          "destinationAnchor",
          "resolverVenueIds",
          "citations",
          "constraintCompliance",
          "travelEstimateKm",
        ],
      },
    },
  },
  required: ["candidates"],
};

export async function researchPlacesWithGemini(
  ctx: GenerateContext,
  attempt = 0
): Promise<{ data: AiPlaceResearchResponse; groundingSources: GroundingSource[] }> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GROUNDING_MODEL_ID)}:generateContent`
  );
  endpoint.searchParams.set("key", env.GEMINI_API_KEY);
  const prompt = `${buildPlaceResearchSystemPrompt(ctx)}\n\nREQUEST\n${buildPlaceResearchUserPrompt(ctx)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: PLACE_JSON_SCHEMA,
        thinkingConfig: { thinkingBudget: 400 },
      },
    }),
    // Gemini attempts must fail over to the DeepSeek fallback chain fast
    // during a provider outage (e.g. 503 "high demand"); this stays short and
    // independent of the much larger DeepSeek grounded/composition timeout.
    signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini grounding failed ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    candidates?: {
      finishReason?: string;
      finishMessage?: string;
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
    }[];
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  };
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text && attempt < 1) {
    logger.warn("Gemini place grounding returned no text; retrying once", {
      model: env.GROUNDING_MODEL_ID,
      finishReason: candidate?.finishReason,
      finishMessage: candidate?.finishMessage,
      blockReason: payload.promptFeedback?.blockReason,
      partCount: candidate?.content?.parts?.length ?? 0,
    });
    return researchPlacesWithGemini(ctx, attempt + 1);
  }
  const parsed = text ? safeJsonParse(text) : null;
  const validated = aiPlaceResearchResponseSchema.safeParse(parsed);
  if (!validated.success) {
    if (attempt < 1) {
      logger.warn("Gemini place dossier failed validation; retrying once", {
        model: env.GROUNDING_MODEL_ID,
        issue: validated.error.message.slice(0, 400),
      });
      return researchPlacesWithGemini(ctx, attempt + 1);
    }
    throw new Error(`Gemini place dossier failed validation: ${validated.error.message.slice(0, 400)}`);
  }

  const chunkSources: GroundingSource[] = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .filter((chunk) => chunk.web?.uri)
    .map((chunk) => ({ url: chunk.web!.uri!, title: chunk.web?.title ?? "Google Search source" }));
  const chunkUrls = new Set(chunkSources.map((source) => normalizeUrl(source.url)));
  const places = validated.data.places.filter((place) => {
    if (chunkUrls.has(normalizeUrl(place.sourceUrl))) return true;
    try {
      const url = new URL(place.sourceUrl);
      return (
        url.protocol === "https:" &&
        url.hostname.includes(".") &&
        !url.hostname.endsWith(".example") &&
        url.hostname !== "example.com"
      );
    } catch {
      return false;
    }
  });
  if (places.length < 4) throw new Error("Gemini returned fewer than four verifiable grounding links");

  const groundingSources = Array.from(
    new Map(
      [...chunkSources, ...places.map((place) => ({ url: place.sourceUrl, title: place.sourceLabel }))].map((source) => [
        normalizeUrl(source.url),
        source,
      ])
    ).values()
  );
  logger.info("Gemini place grounding succeeded", { model: env.GROUNDING_MODEL_ID, placeCount: places.length });
  return { data: { places }, groundingSources };
}

export async function composePlanWithGemini(ctx: GenerateContext): Promise<AiGenerateResponse> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GROUNDING_MODEL_ID)}:generateContent`
  );
  endpoint.searchParams.set("key", env.GEMINI_API_KEY);
  const prompt = `${buildGenerateSystemPrompt(ctx)}\n\nREQUEST\n${buildGenerateUserPrompt(ctx)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: PLAN_JSON_SCHEMA,
        maxOutputTokens: 8000,
        thinkingConfig: { thinkingBudget: 400 },
      },
    }),
    // Gemini attempts must fail over to the DeepSeek fallback chain fast
    // during a provider outage (e.g. 503 "high demand"); this stays short and
    // independent of the much larger DeepSeek grounded/composition timeout.
    signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini composition failed ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    candidates?: {
      finishReason?: string;
      finishMessage?: string;
      content?: { parts?: { text?: string }[] };
    }[];
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  };
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    logger.warn("Gemini plan composition returned no text", {
      model: env.GROUNDING_MODEL_ID,
      finishReason: candidate?.finishReason,
      finishMessage: candidate?.finishMessage,
      blockReason: payload.promptFeedback?.blockReason,
      partCount: candidate?.content?.parts?.length ?? 0,
    });
  }
  const parsed = text ? safeJsonParse(text) : null;
  const validated = aiGenerateResponseSchema.safeParse(normalizePresentationLengths(parsed));
  if (!validated.success) throw new Error(`Gemini plan failed validation: ${validated.error.message.slice(0, 500)}`);
  logger.info("Gemini plan composition succeeded", { model: env.GROUNDING_MODEL_ID });
  return validated.data;
}

function clipped(value: unknown, max: number): unknown {
  if (typeof value !== "string" || value.length <= max) return value;
  const slice = value.slice(0, Math.max(1, max - 1));
  const boundary = slice.lastIndexOf(" ");
  return `${(boundary > max * 0.7 ? slice.slice(0, boundary) : slice).trimEnd()}\u2026`;
}

/**
 * Structured models occasionally exceed a requested UI copy limit by a few
 * characters. Truncating presentation copy is safe; place names, URLs, facts,
 * constraint decisions, and numeric itinerary data remain untouched and are
 * still strictly validated by Zod afterward.
 */
function normalizePresentationLengths(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const root = input as { candidates?: unknown[] };
  if (!Array.isArray(root.candidates)) return input;
  for (const value of root.candidates) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    candidate.title = clipped(candidate.title, 120);
    candidate.rationale = clipped(candidate.rationale, 600);
    candidate.category = clipped(candidate.category, 60);
    candidate.estimatedCost = clipped(candidate.estimatedCost, 120);
    candidate.photoSearchTerm = clipped(candidate.photoSearchTerm, 160);
    candidate.destinationAnchor = clipped(candidate.destinationAnchor, 200);
    if (Array.isArray(candidate.checkBeforeYouGo)) {
      candidate.checkBeforeYouGo = candidate.checkBeforeYouGo.slice(0, 8).map((item) => clipped(item, 240));
    }
    if (Array.isArray(candidate.beats)) {
      for (const beatValue of candidate.beats) {
        if (!beatValue || typeof beatValue !== "object") continue;
        const beat = beatValue as Record<string, unknown>;
        beat.title = clipped(beat.title, 120);
        beat.description = clipped(beat.description, 400);
        beat.category = clipped(beat.category, 60);
      }
    }
    if (candidate.fallback && typeof candidate.fallback === "object") {
      const fallback = candidate.fallback as Record<string, unknown>;
      fallback.title = clipped(fallback.title, 140);
      fallback.description = clipped(fallback.description, 300);
    }
  }
  return input;
}

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
}

import { env, isTest } from "../env.js";
import { logger } from "../logger.js";
import {
  aiChatResponseSchema,
  aiFeedbackResponseSchema,
  aiGenerateResponseSchema,
  aiEventFeatureResponseSchema,
  aiPlanActionResponseSchema,
  type AiChatResponse,
  type AiFeedbackResponse,
  type AiGenerateResponse,
  type AiEventFeatureResponse,
  type AiPlaceResearchResponse,
  type AiPlanActionResponse,
} from "../../shared/schemas.js";
import { callAiJson, AiUnavailableError, type GroundingSource } from "./deepseek.js";
import {
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildFeedbackSystemPrompt,
  buildFeedbackUserPrompt,
  buildEventFeatureSystemPrompt,
  buildEventFeatureUserPrompt,
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildPlanActionSystemPrompt,
  buildPlanActionUserPrompt,
} from "./prompts.js";
import { chatRespondDemo, feedbackExtractDemo, generateCandidatesDemo, generateQuickFallback, type ChatContext, type GenerateContext } from "./demoAi.js";
import type { Candidate } from "../../shared/types.js";
import type { ProgressReporter } from "../plans/engine/stages.js";

export type AiMode = "deepseek" | "gemini-grounded" | "demo";

export function currentAiMode(): AiMode {
  return !isTest && env.OPENROUTER_API_KEY ? "deepseek" : "demo";
}

const MAX_VENUE_NAME_LENGTH = 30;

function truncateVenueName(name: string): string {
  if (name.length <= MAX_VENUE_NAME_LENGTH) return name;
  return `${name.slice(0, MAX_VENUE_NAME_LENGTH - 1).trimEnd()}…`;
}

/**
 * Builds the "Composing around <place 1>, <place 2> + K more" sub-status
 * shown while the composer is drafting, so the long static "Composing your
 * plan" stage narrates real venues from the grounded dossier instead of
 * sitting silent. Caps at 2 names (+ a count of the rest); each name is
 * truncated past 30 characters. Falls back to a generic message when there
 * are no named places yet (e.g. demo mode, or edit flows with no dossier).
 */
export function formatVenueDetail(placeNames: string[]): string {
  const names = placeNames.map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) return "Composing your plan";
  const shown = names.slice(0, 2).map(truncateVenueName);
  const remaining = names.length - shown.length;
  return remaining > 0
    ? `Composing around ${shown.join(", ")} + ${remaining} more`
    : `Composing around ${shown.join(", ")}`;
}

/** Fast JSON can be schema-valid and still be a bad plan. Keep a tiny,
 * deterministic product-quality gate on the one-click path so repeated stops,
 * missing venues, Lisbon "lakes", or a generic food hall for a restaurant
 * request fall through to the concrete route instead of reaching the user. */
export function quickPlanQualityIssue(response: AiGenerateResponse, ctx: GenerateContext): string | null {
  const candidate = response.candidates[0];
  if (!candidate || candidate.beats.length !== 3) return "missing three-beat candidate";
  const places = candidate.beats.map((beat) => beat.place);
  if (places.some((place) => !place?.name || !place.sourceUrl)) return "missing named Maps-ready place";
  const placeNames = places.map((place) => normalizedPlaceName(place!.name));
  if (new Set(placeNames).size !== placeNames.length) return "repeated route stop";

  const planText = [
    candidate.title,
    candidate.rationale,
    ...candidate.beats.flatMap((beat) => [beat.title, beat.description, beat.place?.kind ?? ""]),
  ].join(" ");
  if (/lisbo[an]|lisbon/i.test(ctx.homeBaseLabel ?? "") && /\blake(?:side)?\b/i.test(planText)) {
    return "invalid Lisbon lake framing";
  }
  const wantsMeal = /\b(meal|lunch|dinner|restaurant|fish|meat|grill(?:ed)?)\b/i.test(ctx.moodContext ?? "");
  const mealIdentity = candidate.beats[1].place?.kind ?? "";
  if (wantsMeal && !/restaurant|grill|seafood|fish|steak|churrasc|tavern|bistro|tasca/i.test(mealIdentity)) {
    return "meal stop is not a specific restaurant";
  }
  return null;
}

export async function generateCandidates(
  ctx: GenerateContext,
  report?: ProgressReporter
): Promise<{ mode: AiMode; response: AiGenerateResponse; groundingSources: GroundingSource[] }> {
  if (currentAiMode() === "demo") {
    await report?.("composing_plan");
    return { mode: "demo", response: generateCandidatesDemo(ctx), groundingSources: [] };
  }
  const composingEvent = (detail: string) => {
    void report?.("composing_plan", detail);
  };
  composingEvent("Making your best plan now");
  try {
    const response = await callAiJson(
      buildGenerateSystemPrompt(ctx, true),
      buildGenerateUserPrompt(ctx, true),
      aiGenerateResponseSchema,
      { fast: true, onEvent: composingEvent }
    );
    const qualityIssue = quickPlanQualityIssue(response, ctx);
    if (qualityIssue) throw new Error(`Fast plan quality gate: ${qualityIssue}`);
    return { mode: "deepseek", response, groundingSources: [] };
  } catch (err) {
    logger.warn("Fast plan call unavailable; using immediate deterministic fallback", { error: String(err) });
    composingEvent("Using your saved preferences to finish instantly");
    return { mode: "demo", response: generateQuickFallback(ctx), groundingSources: [] };
  }

  /* Legacy two-call grounding/composition pipeline retained here only as
     migration context; the one-click product path above intentionally does
     not execute it.

    const groundingEvent = (detail: string) => {
      void report?.("grounding_places", detail);
    };
    const composingEvent = (detail: string) => {
      void report?.("composing_plan", detail);
    };

    groundingEvent(`Scouting cafés, restaurants and sights near ${ctx.homeBaseLabel ?? "your area"}`);
    let research;
    if (env.GEMINI_API_KEY) {
      try {
        research = await researchPlacesWithGemini(ctx);
      } catch (geminiGroundingError) {
        logger.warn("Gemini place grounding failed; retrying with DeepSeek web search", {
          error: String(geminiGroundingError),
        });
        groundingEvent("Taking a different scouting route…");
        research = await callAiJsonGrounded(
          buildPlaceResearchSystemPrompt(ctx),
          buildPlaceResearchUserPrompt(ctx),
          aiPlaceResearchResponseSchema,
          { onEvent: groundingEvent }
        );
      }
    } else {
      research = await callAiJsonGrounded(
        buildPlaceResearchSystemPrompt(ctx),
        buildPlaceResearchUserPrompt(ctx),
        aiPlaceResearchResponseSchema,
        { onEvent: groundingEvent }
      );
    }
    const allowedUrls = new Set(research.groundingSources.map((source) => normalizeSourceUrl(source.url)));
    const groundedPlaces = research.data.places.filter((place) => allowedUrls.has(normalizeSourceUrl(place.sourceUrl)));
    if (groundedPlaces.length < 4) {
      throw new Error("Place research did not return enough citation-backed places");
    }
    groundingEvent(`Found ${groundedPlaces.length} real places worth considering`);

    const generationContext: GenerateContext = { ...ctx, groundedPlaces };
    composingEvent(formatVenueDetail(groundedPlaces.map((place) => place.name)));
    let response: AiGenerateResponse;
    if (env.GEMINI_API_KEY) {
      try {
        response = await composePlanWithGemini(generationContext);
      } catch (geminiError) {
        logger.warn("Gemini composition failed; retrying the grounded dossier with DeepSeek", {
          error: String(geminiError),
        });
        composingEvent("Drafting your route");
        response = await callAiJson(
          buildGenerateSystemPrompt(generationContext),
          buildGenerateUserPrompt(generationContext),
          aiGenerateResponseSchema,
          { heavy: true, onEvent: composingEvent }
        );
      }
    } else {
      composingEvent("Drafting your route");
      response = await callAiJson(
        buildGenerateSystemPrompt(generationContext),
        buildGenerateUserPrompt(generationContext),
        aiGenerateResponseSchema,
        { heavy: true, onEvent: composingEvent }
      );
    }
    return {
      mode: env.GEMINI_API_KEY ? "gemini-grounded" : "deepseek",
      response: canonicalizeCandidatePlaces(response, groundedPlaces),
      groundingSources: research.groundingSources,
    };
  } catch (err) {
    logger.error("Grounded plan generation unavailable", { error: String(err) });
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError("Grounded plan generation unavailable");
  }
  */
}

function normalizedPlaceName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The composer is allowed to choose and arrange dossier places, but it never
 * owns their factual payload. Replace every exact name match with the
 * server-held canonical object so a model cannot subtly mutate a redirect URL,
 * address, source label, or source-backed note. Unknown names remain untouched
 * and are rejected by the downstream place-source firewall.
 */
export function canonicalizeCandidatePlaces(
  response: AiGenerateResponse,
  groundedPlaces: AiPlaceResearchResponse["places"]
): AiGenerateResponse {
  const byName = new Map(groundedPlaces.map((place) => [normalizedPlaceName(place.name), place]));
  const canonicalPlace = (place: AiGenerateResponse["candidates"][number]["beats"][number]["place"]) => {
    if (!place) return place;
    const source = byName.get(normalizedPlaceName(place.name));
    if (!source) return place;
    return {
      name: source.name,
      address: source.address ?? null,
      kind: source.kind,
      sourceUrl: source.sourceUrl,
      sourceLabel: source.sourceLabel,
      factualNote: source.factualNote,
    };
  };
  return {
    candidates: response.candidates.map((candidate) => ({
      ...candidate,
      beats: candidate.beats.map((beat) => ({ ...beat, place: canonicalPlace(beat.place) })),
      fallback: candidate.fallback
        ? { ...candidate.fallback, place: canonicalPlace(candidate.fallback.place) }
        : candidate.fallback,
    })),
  };
}

export async function chatRespond(ctx: ChatContext): Promise<{ mode: AiMode; response: AiChatResponse }> {
  if (currentAiMode() === "demo") {
    return { mode: "demo", response: chatRespondDemo(ctx) };
  }
  try {
    const response = await callAiJson(
      buildChatSystemPrompt(),
      buildChatUserPrompt(ctx.message),
      aiChatResponseSchema
    );
    return { mode: "deepseek", response };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { mode: "demo", response: chatRespondDemo(ctx) };
    }
    logger.error("DeepSeek chat failed, falling back to demo AI", { error: String(err) });
    return { mode: "demo", response: chatRespondDemo(ctx) };
  }
}

export async function feedbackExtract(rating: number, comment: string | null): Promise<{ mode: AiMode; response: AiFeedbackResponse }> {
  if (!comment || comment.trim().length === 0) {
    return { mode: currentAiMode(), response: { evidence: [] } };
  }
  if (currentAiMode() === "demo") {
    return { mode: "demo", response: feedbackExtractDemo(comment) };
  }
  try {
    const response = await callAiJson(
      buildFeedbackSystemPrompt(),
      buildFeedbackUserPrompt(rating, comment),
      aiFeedbackResponseSchema
    );
    return { mode: "deepseek", response };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { mode: "demo", response: feedbackExtractDemo(comment) };
    }
    logger.error("DeepSeek feedback extraction failed, falling back to demo AI", { error: String(err) });
    return { mode: "demo", response: feedbackExtractDemo(comment) };
  }
}

function eventFeatureFallback(candidate: Candidate): AiEventFeatureResponse {
  const features: string[] = [];
  if (candidate.walkingMinutes != null) {
    features.push(
      candidate.walkingMinutes <= 75
        ? "A relaxed amount of walking with plenty of time to enjoy each stop"
        : "An active, walk-forward plan with meaningful time outdoors"
    );
  }
  features.push(candidate.indoor ? "A mostly indoor setting" : "A mostly outdoor setting with fresh-air time");
  const mealCategories = candidate.beats
    .map((beat) => beat.category)
    .filter((category) => /food|meal|dinner|lunch|restaurant|fish|grill/i.test(category));
  if (mealCategories.length) features.push("A plan anchored by a satisfying meal rather than snacks on the move");
  if (candidate.estimatedCost) features.push(`A comfortable spend around ${candidate.estimatedCost}`);
  if ((candidate.preparation?.pet.length ?? 0) > 0) features.push("A route that works thoughtfully with a pet");
  if (candidate.beats.length >= 3) features.push("A compact beginning-middle-end itinerary instead of disconnected ideas");
  const unique = Array.from(new Set(features)).slice(0, 6);
  while (unique.length < 2) unique.push("An easy-to-follow plan with practical timing");
  return {
    summary: unique.slice(0, 3).join("; "),
    features: unique,
  };
}

export async function eventFeatureExtract(
  candidate: Candidate
): Promise<{ mode: AiMode; response: AiEventFeatureResponse }> {
  const structure = {
    category: candidate.category,
    mostlyIndoor: candidate.indoor,
    walkingMinutes: candidate.walkingMinutes,
    walkingDistanceKm: candidate.walkingDistanceKm,
    estimatedCost: candidate.estimatedCost,
    beatShape: candidate.beats.map((beat) => ({
      category: beat.category,
      indoor: beat.indoor,
      durationMinutes: beat.durationMinutes ?? null,
      travelMode: beat.travelMode ?? null,
    })),
    petPreparationIncluded: (candidate.preparation?.pet.length ?? 0) > 0,
  };
  if (currentAiMode() === "demo") return { mode: "demo", response: eventFeatureFallback(candidate) };
  try {
    const response = await callAiJson(
      buildEventFeatureSystemPrompt(),
      buildEventFeatureUserPrompt(structure),
      aiEventFeatureResponseSchema
    );
    return { mode: "deepseek", response };
  } catch (err) {
    logger.warn("DeepSeek Love extraction failed, using structural fallback", { error: String(err) });
    return { mode: "demo", response: eventFeatureFallback(candidate) };
  }
}

function planActionFallback(message: string): AiPlanActionResponse {
  const normalized = message.toLowerCase();
  if (/\blove\b/.test(normalized)) return { action: "react", reaction: "love", editMode: null, instruction: message, reply: "Loved. I'll save what makes this plan your kind of day." };
  if (/\b(dislike|hate|not this)\b/.test(normalized)) return { action: "react", reaction: "dislike", editMode: null, instruction: message, reply: "Understood. I'll record that this one missed." };
  if (/\blike\b/.test(normalized)) return { action: "react", reaction: "like", editMode: null, instruction: message, reply: "Liked. I'll use that as a light positive signal." };
  if (/\b(lock|save|choose|book it)\b/.test(normalized)) return { action: "lock", reaction: null, editMode: null, instruction: message, reply: "I'll lock this plan into History." };
  if (/\b(share|send|copy link)\b/.test(normalized)) return { action: "share", reaction: null, editMode: null, instruction: message, reply: "I'll make a private share link for this itinerary." };
  if (/\b(invite|add).{0,20}\bfriend\b/.test(normalized)) return { action: "invite_friend", reaction: null, editMode: null, instruction: message, reply: "I'll create a one-time friend invite." };
  if (/\b(another|different option|new option)\b/.test(normalized)) return { action: "show_another", reaction: null, editMode: null, instruction: message, reply: "I'll find another grounded option." };
  const mode = /restaurant|cafe|café|meal venue/.test(normalized)
    ? "restaurant"
    : /dinner|lunch|breakfast|later|earlier|time/.test(normalized)
      ? "meal_time"
      : /cheap|cheaper|less expensive|lower cost|budget/.test(normalized)
        ? "budget"
        : /walk|walking|closer|distance/.test(normalized)
          ? "walking"
          : "general";
  if (/\b(why|explain|what|where|when|how)\b/.test(normalized) && !/change|make|replace|swap|move|less|more/.test(normalized)) {
    return { action: "explain", reaction: null, editMode: null, instruction: message, reply: "This plan was chosen for its fit, route coherence, and current grounded places." };
  }
  return { action: "edit", reaction: null, editMode: mode, instruction: message, reply: "I'll make the smallest safe change and keep the current plan available." };
}

export async function planActionInterpret(message: string, candidate: Candidate): Promise<{ mode: AiMode; response: AiPlanActionResponse }> {
  const visiblePlan = {
    title: candidate.title,
    category: candidate.category,
    walkingMinutes: candidate.walkingMinutes,
    estimatedCost: candidate.estimatedCost,
    beats: candidate.beats.map((beat, index) => ({ index, title: beat.title, category: beat.category, startTime: beat.startTime, place: beat.place?.name ?? null })),
  };
  if (currentAiMode() === "demo") return { mode: "demo", response: planActionFallback(message) };
  try {
    const response = await callAiJson(buildPlanActionSystemPrompt(), buildPlanActionUserPrompt(message, visiblePlan), aiPlanActionResponseSchema);
    return { mode: "deepseek", response };
  } catch (err) {
    logger.warn("Plan action routing failed, using deterministic router", { error: String(err) });
    return { mode: "demo", response: planActionFallback(message) };
  }
}

export type { GenerateContext, MemoryFact, ChatContext } from "./demoAi.js";

import { env, isTest } from "../env.js";
import { logger } from "../logger.js";
import {
  aiChatResponseSchema,
  aiFeedbackResponseSchema,
  aiGenerateResponseSchema,
  aiPlaceResearchResponseSchema,
  type AiChatResponse,
  type AiFeedbackResponse,
  type AiGenerateResponse,
} from "../../shared/schemas.js";
import { callAiJson, callAiJsonGrounded, AiUnavailableError, type GroundingSource } from "./deepseek.js";
import {
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildFeedbackSystemPrompt,
  buildFeedbackUserPrompt,
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildPlaceResearchSystemPrompt,
  buildPlaceResearchUserPrompt,
} from "./prompts.js";
import { chatRespondDemo, feedbackExtractDemo, generateCandidatesDemo, type ChatContext, type GenerateContext } from "./demoAi.js";
import { composePlanWithGemini, researchPlacesWithGemini } from "../grounding/geminiPlaces.js";

export type AiMode = "deepseek" | "gemini-grounded" | "demo";

export function currentAiMode(): AiMode {
  return !isTest && env.OPENROUTER_API_KEY ? "deepseek" : "demo";
}

export async function generateCandidates(
  ctx: GenerateContext
): Promise<{ mode: AiMode; response: AiGenerateResponse; groundingSources: GroundingSource[] }> {
  if (currentAiMode() === "demo") {
    return { mode: "demo", response: generateCandidatesDemo(ctx), groundingSources: [] };
  }
  try {
    const research = env.GEMINI_API_KEY
      ? await researchPlacesWithGemini(ctx)
      : await callAiJsonGrounded(
          buildPlaceResearchSystemPrompt(),
          buildPlaceResearchUserPrompt(ctx),
          aiPlaceResearchResponseSchema
        );
    const allowedUrls = new Set(research.groundingSources.map((source) => normalizeSourceUrl(source.url)));
    const groundedPlaces = research.data.places.filter((place) => allowedUrls.has(normalizeSourceUrl(place.sourceUrl)));
    if (groundedPlaces.length < 4) {
      throw new Error("Place research did not return enough citation-backed places");
    }
    const generationContext: GenerateContext = { ...ctx, groundedPlaces };
    let response: AiGenerateResponse;
    if (env.GEMINI_API_KEY) {
      try {
        response = await composePlanWithGemini(generationContext);
      } catch (geminiError) {
        logger.warn("Gemini composition failed; retrying the grounded dossier with DeepSeek", {
          error: String(geminiError),
        });
        response = await callAiJson(
          buildGenerateSystemPrompt(),
          buildGenerateUserPrompt(generationContext),
          aiGenerateResponseSchema
        );
      }
    } else {
      response = await callAiJson(
        buildGenerateSystemPrompt(),
        buildGenerateUserPrompt(generationContext),
        aiGenerateResponseSchema
      );
    }
    return {
      mode: env.GEMINI_API_KEY ? "gemini-grounded" : "deepseek",
      response,
      groundingSources: research.groundingSources,
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { mode: "demo", response: generateCandidatesDemo(ctx), groundingSources: [] };
    }
    logger.error("DeepSeek generate failed, falling back to demo AI", { error: String(err) });
    return { mode: "demo", response: generateCandidatesDemo(ctx), groundingSources: [] };
  }
}

function normalizeSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
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

export type { GenerateContext, MemoryFact, ChatContext } from "./demoAi.js";

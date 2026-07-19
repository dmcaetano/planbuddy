import { env } from "../env.js";
import { logger } from "../logger.js";
import {
  aiChatResponseSchema,
  aiFeedbackResponseSchema,
  aiGenerateResponseSchema,
  type AiChatResponse,
  type AiFeedbackResponse,
  type AiGenerateResponse,
} from "../../shared/schemas.js";
import { callAiJson, AiUnavailableError } from "./deepseek.js";
import {
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildFeedbackSystemPrompt,
  buildFeedbackUserPrompt,
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
} from "./prompts.js";
import { chatRespondDemo, feedbackExtractDemo, generateCandidatesDemo, type ChatContext, type GenerateContext } from "./demoAi.js";

export type AiMode = "deepseek" | "demo";

export function currentAiMode(): AiMode {
  return env.OPENROUTER_API_KEY ? "deepseek" : "demo";
}

export async function generateCandidates(ctx: GenerateContext): Promise<{ mode: AiMode; response: AiGenerateResponse }> {
  if (currentAiMode() === "demo") {
    return { mode: "demo", response: generateCandidatesDemo(ctx) };
  }
  try {
    const response = await callAiJson(
      buildGenerateSystemPrompt(),
      buildGenerateUserPrompt(ctx),
      aiGenerateResponseSchema
    );
    return { mode: "deepseek", response };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { mode: "demo", response: generateCandidatesDemo(ctx) };
    }
    logger.error("DeepSeek generate failed, falling back to demo AI", { error: String(err) });
    return { mode: "demo", response: generateCandidatesDemo(ctx) };
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

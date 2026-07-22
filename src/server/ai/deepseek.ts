import type { ZodType, ZodTypeDef } from "zod";
import { env } from "../env.js";
import { logger } from "../logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class AiUnavailableError extends Error {}

/**
 * OpenRouter returned finish_reason "length" with an empty message: the
 * reasoning model spent its entire completion-token budget on hidden
 * reasoning tokens and had nothing left for visible content. This is
 * recoverable -- a single retry with reasoning forced low/excluded almost
 * always yields real content -- so it is distinguished from a hard failure.
 */
export class ReasoningStarvedError extends Error {
  constructor(message = "OpenRouter exhausted its token budget on reasoning and returned no content") {
    super(message);
    this.name = "ReasoningStarvedError";
  }
}

export interface GroundingSource {
  url: string;
  title: string;
}

interface AiCallOptions {
  webSearch?: boolean;
  repairNote?: string;
  /** One-click planning: direct answer, short deadline, no latency-multiplying retries. */
  fast?: boolean;
  /** Full plan composition runs a materially larger schema than chat/feedback/etc. and needs more token + time headroom. */
  heavy?: boolean;
  /** Internal: set on the single retry after a ReasoningStarvedError to force a short, low-reasoning answer. */
  directAnswer?: boolean;
  /** Internal: set on the single retry after a provider timeout so a slow provider gets exactly one more attempt. */
  timeoutRetry?: boolean;
  /**
   * Optional short-sentence narration hook for the async job's sub-status
   * (see plans/jobs.ts persistStage). Deliberately just `(detail: string) =>
   * void` — this module has no idea what a "stage" or a "job" is; the
   * caller (ai/index.ts) decides which stage a given detail belongs to.
   * Never throws into the AI call path.
   */
  onEvent?: (detail: string) => void;
}

/** Human-facing narration strings for the recoverable retry paths below. */
const EVENT_REASONING_RETRY = "Almost had it — asking for a cleaner draft";
const EVENT_TIMEOUT_RETRY = "The kitchen is busy — giving it another minute";
export const EVENT_VALIDATION_REPAIR = "Polishing the draft";

function emit(options: AiCallOptions, detail: string): void {
  try {
    options.onEvent?.(detail);
  } catch (err) {
    logger.warn("AI progress onEvent callback threw; ignoring", { error: String(err) });
  }
}

interface RawAiReply {
  content: string;
  groundingSources: GroundingSource[];
}

async function callOpenRouter(systemPrompt: string, userPrompt: string, options: AiCallOptions = {}): Promise<RawAiReply> {
  if (!env.OPENROUTER_API_KEY) {
    throw new AiUnavailableError("OPENROUTER_API_KEY not configured");
  }
  const directAnswerNote = options.directAnswer || options.fast
    ? "\n\nAnswer directly now. Do not use extended step-by-step reasoning -- respond immediately with the final JSON only."
    : "";
  const messages = options.webSearch
    ? [{ role: "user", content: `${systemPrompt}${directAnswerNote}\n\nREQUEST\n${userPrompt}` }]
    : [
        { role: "system", content: `${systemPrompt}${directAnswerNote}` },
        { role: "user", content: userPrompt },
      ];
  if (options.repairNote) {
    messages.push({ role: "user", content: `Your previous reply was invalid: ${options.repairNote}. Reply again with corrected JSON only.` });
  }

  const controller = new AbortController();
  // Grounded web-search and full plan-composition calls carry much larger
  // reasoning+content budgets than chat/feedback JSON and need real
  // wall-clock headroom, especially when running as the DeepSeek fallback
  // for a degraded Gemini. Lightweight calls keep the shorter timeout.
  const timeoutMs = options.fast
    ? env.AI_FAST_TIMEOUT_MS
    : options.webSearch || options.heavy
      ? env.AI_COMPOSE_TIMEOUT_MS
      : env.AI_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const model = options.fast ? env.FAST_MODEL_ID : env.MODEL_ID;
    // Candidate generation (composition) is materially larger than
    // chat/feedback JSON. Give the fast model enough room for a cold
    // provider start while retaining a hard upper bound so the deterministic
    // fallback can still take over.
    const maxTokens = options.webSearch ? 12000 : options.fast ? 9000 : options.heavy ? 28000 : 6000;
    // Reasoning models can silently spend the *entire* completion-token
    // budget on hidden reasoning and emit zero visible content (see
    // ReasoningStarvedError above -- this is exactly what happened in
    // production: 24.5k reasoning tokens, 0 content, against a 6000-token
    // cap). Always cap reasoning tokens well under max_tokens so real
    // content headroom survives even a "high demand" degraded run.
    const reasoning =
      options.webSearch || options.directAnswer || options.fast
        ? { effort: "low" as const, exclude: true }
        : { max_tokens: options.heavy ? 8000 : Math.min(2500, Math.floor(maxTokens / 2)) };
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: options.webSearch ? 0.45 : options.fast ? 0.5 : 0.7,
        max_tokens: maxTokens,
        reasoning,
        ...(options.webSearch
          ? {
              // DeepSeek currently completes a single injected Exa search far
              // more reliably than the model-controlled multi-search tool,
              // which can consume the whole request timeout without a final
              // answer. Citations use the same standardized annotation shape.
              plugins: [{ id: "web", engine: "exa", max_results: 5 }],
            }
          : {}),
        // Baidu's FP8 endpoint is the current low-latency, structured-output
        // path for this exact model. OpenRouter may still fall through to its
        // other providers if that endpoint is unavailable.
        ...(options.webSearch || !model.toLowerCase().includes("deepseek")
          ? {}
          : {
              provider: {
                order: ["baidu"],
                allow_fallbacks: true,
                require_parameters: true,
              },
            }),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string;
          annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[];
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
    const content = message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;
    if (!content) {
      logger.warn("OpenRouter returned an empty assistant message", {
        choiceCount: data.choices?.length ?? 0,
        messageKeys: message ? Object.keys(message) : [],
        finishReason,
        reasoningLength: ((message as { reasoning?: string } | undefined)?.reasoning ?? "").length,
        annotationCount: message?.annotations?.length ?? 0,
        hasToolCalls: Boolean((message as { tool_calls?: unknown[] } | undefined)?.tool_calls?.length),
      });
      if (finishReason === "length" && !options.directAnswer && !options.fast) {
        throw new ReasoningStarvedError();
      }
      throw new Error("OpenRouter returned no content");
    }
    const groundingSources = (message.annotations ?? [])
      .filter((a) => a.type === "url_citation" && a.url_citation?.url)
      .map((a) => ({ url: a.url_citation!.url!, title: a.url_citation?.title ?? "Web source" }));
    return { content, groundingSources };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Wraps a single OpenRouter call with the one-shot reasoning-starvation
 * recovery: if the model burned its whole token budget on reasoning and
 * returned no content, retry exactly once with reasoning forced low and an
 * explicit "answer directly" instruction instead of failing the whole
 * generation outright.
 */
function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

async function callWithLengthRetry(systemPrompt: string, userPrompt: string, options: AiCallOptions): Promise<RawAiReply> {
  try {
    return await callOpenRouter(systemPrompt, userPrompt, options);
  } catch (err) {
    if (err instanceof ReasoningStarvedError) {
      logger.warn("AI call hit its reasoning token cap with no content; retrying once as a direct answer", {
        model: env.MODEL_ID,
        webSearch: Boolean(options.webSearch),
        heavy: Boolean(options.heavy),
      });
      emit(options, EVENT_REASONING_RETRY);
      return callOpenRouter(systemPrompt, userPrompt, { ...options, directAnswer: true });
    }
    // A slow provider under load is transient more often than it is broken —
    // the background-job architecture can afford exactly one more attempt.
    if (isAbortLike(err) && !options.fast && (options.webSearch || options.heavy) && !options.timeoutRetry) {
      logger.warn("AI call timed out; retrying once", {
        model: env.MODEL_ID,
        webSearch: Boolean(options.webSearch),
        heavy: Boolean(options.heavy),
      });
      emit(options, EVENT_TIMEOUT_RETRY);
      return callWithLengthRetry(systemPrompt, userPrompt, { ...options, timeoutRetry: true });
    }
    throw err;
  }
}

/**
 * Calls the model, validates the JSON reply against `schema`, and — on any
 * parse or schema failure — retries exactly once with a repair note before
 * giving up. Non-sensitive request metadata only is logged; full prompts
 * containing user content are not persisted in logs.
 */
export async function callAiJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  options: { heavy?: boolean; fast?: boolean; onEvent?: (detail: string) => void } = {}
): Promise<T> {
  const model = options.fast ? env.FAST_MODEL_ID : env.MODEL_ID;
  let raw = await callWithLengthRetry(systemPrompt, userPrompt, options);
  let parsed = safeJsonParse(raw.content);
  let result = parsed ? schema.safeParse(parsed) : null;

  if ((!result || !result.success) && !options.fast) {
    const issue = result ? JSON.stringify(result.error.flatten()).slice(0, 400) : "not valid JSON";
    logger.warn("AI response failed validation, attempting one repair", { model, issue });
    emit(options, EVENT_VALIDATION_REPAIR);
    raw = await callWithLengthRetry(systemPrompt, userPrompt, { ...options, repairNote: issue });
    parsed = safeJsonParse(raw.content);
    result = parsed ? schema.safeParse(parsed) : null;
  }

  if (!result || !result.success) {
    logger.error("AI response failed validation after repair attempt", { model });
    throw new Error("AI response did not match the expected contract after repair");
  }

  logger.info("AI call succeeded", { model });
  return result.data;
}

/**
 * Grounded generation variant. OpenRouter gives DeepSeek a bounded web-search
 * tool and returns the cited URLs separately so the pipeline can enforce that
 * every named place is backed by an actual search result.
 */
export async function callAiJsonGrounded<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  options: { onEvent?: (detail: string) => void } = {}
): Promise<{ data: T; groundingSources: GroundingSource[] }> {
  let raw = await callWithLengthRetry(systemPrompt, userPrompt, { webSearch: true, onEvent: options.onEvent });
  let parsed = safeJsonParse(raw.content);
  let result = parsed ? schema.safeParse(parsed) : null;

  if (!result || !result.success) {
    const issue = result ? JSON.stringify(result.error.flatten()).slice(0, 500) : "not valid JSON";
    logger.warn("Grounded AI response failed validation, attempting one repair", { model: env.MODEL_ID, issue });
    emit(options, EVENT_VALIDATION_REPAIR);
    raw = await callWithLengthRetry(systemPrompt, userPrompt, { webSearch: true, repairNote: issue, onEvent: options.onEvent });
    parsed = safeJsonParse(raw.content);
    result = parsed ? schema.safeParse(parsed) : null;
  }

  if (!result || !result.success) {
    logger.error("Grounded AI response failed validation after repair attempt", { model: env.MODEL_ID });
    throw new Error("Grounded AI response did not match the expected contract after repair");
  }

  logger.info("Grounded AI call succeeded", {
    model: env.MODEL_ID,
    sourceCount: raw.groundingSources.length,
  });
  return { data: result.data, groundingSources: raw.groundingSources };
}

export function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  const attempts = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    attempts.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next conservative envelope. Zod still validates the payload.
    }
  }
  return null;
}

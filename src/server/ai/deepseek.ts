import type { ZodType, ZodTypeDef } from "zod";
import { env } from "../env.js";
import { logger } from "../logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class AiUnavailableError extends Error {}

export interface GroundingSource {
  url: string;
  title: string;
}

interface AiCallOptions {
  webSearch?: boolean;
  repairNote?: string;
}

interface RawAiReply {
  content: string;
  groundingSources: GroundingSource[];
}

async function callOpenRouter(systemPrompt: string, userPrompt: string, options: AiCallOptions = {}): Promise<RawAiReply> {
  if (!env.OPENROUTER_API_KEY) {
    throw new AiUnavailableError("OPENROUTER_API_KEY not configured");
  }
  const messages = options.webSearch
    ? [{ role: "user", content: `${systemPrompt}\n\nREQUEST\n${userPrompt}` }]
    : [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
  if (options.repairNote) {
    messages.push({ role: "user", content: `Your previous reply was invalid: ${options.repairNote}. Reply again with corrected JSON only.` });
  }

  const controller = new AbortController();
  // Candidate generation is materially larger than chat/feedback JSON. Give
  // the fast model enough room for a cold provider start while retaining a
  // hard upper bound so the deterministic fallback can still take over.
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.MODEL_ID,
        messages,
        response_format: { type: "json_object" },
        temperature: options.webSearch ? 0.45 : 0.7,
        max_tokens: options.webSearch ? 5000 : 6000,
        ...(options.webSearch ? { reasoning: { effort: "low", exclude: true } } : {}),
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
        ...(options.webSearch
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
    if (!content) {
      logger.warn("OpenRouter returned an empty assistant message", {
        choiceCount: data.choices?.length ?? 0,
        messageKeys: message ? Object.keys(message) : [],
        finishReason: data.choices?.[0]?.finish_reason,
        reasoningLength: ((message as { reasoning?: string } | undefined)?.reasoning ?? "").length,
        annotationCount: message?.annotations?.length ?? 0,
        hasToolCalls: Boolean((message as { tool_calls?: unknown[] } | undefined)?.tool_calls?.length),
      });
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
 * Calls the model, validates the JSON reply against `schema`, and — on any
 * parse or schema failure — retries exactly once with a repair note before
 * giving up. Non-sensitive request metadata only is logged; full prompts
 * containing user content are not persisted in logs.
 */
export async function callAiJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: ZodType<T, ZodTypeDef, unknown>
): Promise<T> {
  let raw = await callOpenRouter(systemPrompt, userPrompt);
  let parsed = safeJsonParse(raw.content);
  let result = parsed ? schema.safeParse(parsed) : null;

  if (!result || !result.success) {
    const issue = result ? JSON.stringify(result.error.flatten()).slice(0, 400) : "not valid JSON";
    logger.warn("AI response failed validation, attempting one repair", { model: env.MODEL_ID, issue });
    raw = await callOpenRouter(systemPrompt, userPrompt, { repairNote: issue });
    parsed = safeJsonParse(raw.content);
    result = parsed ? schema.safeParse(parsed) : null;
  }

  if (!result || !result.success) {
    logger.error("AI response failed validation after repair attempt", { model: env.MODEL_ID });
    throw new Error("AI response did not match the expected contract after repair");
  }

  logger.info("AI call succeeded", { model: env.MODEL_ID });
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
  schema: ZodType<T, ZodTypeDef, unknown>
): Promise<{ data: T; groundingSources: GroundingSource[] }> {
  let raw = await callOpenRouter(systemPrompt, userPrompt, { webSearch: true });
  let parsed = safeJsonParse(raw.content);
  let result = parsed ? schema.safeParse(parsed) : null;

  if (!result || !result.success) {
    const issue = result ? JSON.stringify(result.error.flatten()).slice(0, 500) : "not valid JSON";
    logger.warn("Grounded AI response failed validation, attempting one repair", { model: env.MODEL_ID, issue });
    raw = await callOpenRouter(systemPrompt, userPrompt, { webSearch: true, repairNote: issue });
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

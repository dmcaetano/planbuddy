import type { ZodType, ZodTypeDef } from "zod";
import { env } from "../env.js";
import { logger } from "../logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class AiUnavailableError extends Error {}

async function callOpenRouter(systemPrompt: string, userPrompt: string, repairNote?: string): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new AiUnavailableError("OPENROUTER_API_KEY not configured");
  }
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  if (repairNote) {
    messages.push({ role: "user", content: `Your previous reply was invalid: ${repairNote}. Reply again with corrected JSON only.` });
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
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned no content");
    return content;
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
  let parsed = safeJsonParse(raw);
  let result = parsed ? schema.safeParse(parsed) : null;

  if (!result || !result.success) {
    const issue = result ? JSON.stringify(result.error.flatten()).slice(0, 400) : "not valid JSON";
    logger.warn("AI response failed validation, attempting one repair", { model: env.MODEL_ID, issue });
    raw = await callOpenRouter(systemPrompt, userPrompt, issue);
    parsed = safeJsonParse(raw);
    result = parsed ? schema.safeParse(parsed) : null;
  }

  if (!result || !result.success) {
    logger.error("AI response failed validation after repair attempt", { model: env.MODEL_ID });
    throw new Error("AI response did not match the expected contract after repair");
  }

  logger.info("AI call succeeded", { model: env.MODEL_ID });
  return result.data;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

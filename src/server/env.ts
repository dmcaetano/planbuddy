import "dotenv/config";
import { z } from "zod";
import { readFileSync } from "node:fs";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SESSION_SECRET: z.string().min(16).default("dev-only-change-me-please-use-a-long-random-string"),
  DATABASE_URL: z.string().url().optional(),
  DB_SCHEMA: z.string().regex(/^[a-z0-9_]+$/).default("planbuddy"),
  PLANBUDDY_DATA_DIR: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY_FILE: z.string().optional(),
  MODEL_ID: z.string().default("deepseek/deepseek-v4-flash"),
  // Plan generation is latency-sensitive and can use a smaller structured
  // model independently from the conversational/memory model above.
  FAST_MODEL_ID: z.string().default("openai/gpt-4o-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_KEY_FILE: z.string().optional(),
  GROUNDING_MODEL_ID: z.string().default("gemini-3.5-flash"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),
  // The one-click path is deliberately bounded. If the provider cannot
  // return a direct structured plan quickly, the deterministic fallback wins
  // instead of making the user watch a multi-minute research chain.
  AI_FAST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(30000).default(12000),
  // Gemini should fail over to the DeepSeek fallback chain fast during a
  // provider outage (e.g. 503 "high demand") rather than let a hung request
  // eat into the overall generation budget.
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(60000).default(30000),
  // Grounded web-search and full plan-composition DeepSeek calls carry much
  // larger reasoning+content token budgets than chat/feedback JSON and need
  // real wall-clock headroom to finish, especially as a Gemini fallback.
  // Generation runs as a background job with no HTTP deadline; the only hard
  // ceiling is the 10-minute interrupted-job sweep. DeepSeek with live web
  // search under provider load routinely needs >90s, so give it real room:
  // worst case (one timeout retry) stays under the sweep at ~2x this value.
  AI_COMPOSE_TIMEOUT_MS: z.coerce.number().int().min(15000).max(300000).default(210000),
  PLACE_RESOLVER_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.SESSION_SECRET === "dev-only-change-me-please-use-a-long-random-string"
) {
  throw new Error("SESSION_SECRET must be explicitly configured in production");
}

let openRouterApiKey = parsed.data.OPENROUTER_API_KEY;
if (!openRouterApiKey && parsed.data.OPENROUTER_API_KEY_FILE) {
  try {
    openRouterApiKey = readFileSync(parsed.data.OPENROUTER_API_KEY_FILE, "utf8").trim();
  } catch {
    // The normal demo fallback remains available when a local key file cannot be read.
  }
}

let geminiApiKey = parsed.data.GEMINI_API_KEY;
if (!geminiApiKey && parsed.data.GEMINI_API_KEY_FILE) {
  try {
    geminiApiKey = readFileSync(parsed.data.GEMINI_API_KEY_FILE, "utf8").trim();
  } catch {
    // Grounding can fall back to the existing OpenRouter path when unavailable.
  }
}

export const env = {
  ...parsed.data,
  OPENROUTER_API_KEY: openRouterApiKey,
  GEMINI_API_KEY: geminiApiKey,
};
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

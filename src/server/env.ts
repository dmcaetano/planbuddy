import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SESSION_SECRET: z.string().min(16).default("dev-only-change-me-please-use-a-long-random-string"),
  DATABASE_URL: z.string().url().optional(),
  DB_SCHEMA: z.string().regex(/^[a-z0-9_]+$/).default("planbuddy"),
  PLANBUDDY_DATA_DIR: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  MODEL_ID: z.string().default("deepseek/deepseek-v4-flash"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),
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

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

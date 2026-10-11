import type { Context } from "hono";
import type { ZodSchema } from "zod";

/**
 * Parses and validates the JSON body against `schema`. On success returns
 * the parsed value; on failure returns a Response (400) that the caller
 * must return immediately (`if (body instanceof Response) return body;`),
 * mirroring the Express build's `validateBody` middleware without needing
 * a separate middleware stage per route.
 */
export async function parseBody<T>(c: Context, schema: ZodSchema<T>): Promise<T | Response> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }
  return parsed.data;
}

export function notFoundResponse(c: Context, message = "Not found"): Response {
  return c.json({ error: message }, 404);
}

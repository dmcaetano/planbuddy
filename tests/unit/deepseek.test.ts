import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { safeJsonParse, callAiJson, callAiJsonGrounded } from "../../src/server/ai/deepseek.js";
import { env } from "../../src/server/env.js";

describe("safeJsonParse", () => {
  it("parses plain JSON", () => {
    expect(safeJsonParse('{"candidates":[]}')).toEqual({ candidates: [] });
  });

  it("accepts a JSON markdown fence from a provider", () => {
    expect(safeJsonParse('```json\n{"candidates":[]}\n```')).toEqual({ candidates: [] });
  });

  it("extracts one complete JSON object from harmless wrapper text", () => {
    expect(safeJsonParse('Here is the result:\n{"candidates":[]}\nDone.')).toEqual({ candidates: [] });
  });

  it("still rejects incomplete JSON", () => {
    expect(safeJsonParse('{"candidates":[')).toBeNull();
  });
});

const testSchema = z.object({ ok: z.boolean() });

function openRouterResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function lengthStarvedBody(reasoningLength = 24499) {
  return { choices: [{ finish_reason: "length", message: { reasoning: "x".repeat(reasoningLength) } }] };
}

function okBody(payload: unknown) {
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] };
}

describe("OpenRouter reasoning-starvation recovery", () => {
  const originalKey = env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    env.OPENROUTER_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retries once as a direct, low-reasoning answer when finishReason is length with empty content", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? openRouterResponse(lengthStarvedBody()) : openRouterResponse(okBody({ ok: true }));
    }) as unknown as typeof fetch;

    const result = await callAiJson("system prompt", "user prompt", testSchema, { heavy: true });

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not retry a second time if the direct-answer retry is also starved (no infinite loop)", async () => {
    global.fetch = vi.fn(async () => openRouterResponse(lengthStarvedBody(500))) as unknown as typeof fetch;

    await expect(callAiJson("system prompt", "user prompt", testSchema)).rejects.toThrow();
    expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it("gives heavy composition calls a large max_tokens budget with a reasoning cap well under it", async () => {
    global.fetch = vi.fn(async () => openRouterResponse(okBody({ ok: true }))) as unknown as typeof fetch;

    await callAiJson("system prompt", "user prompt", testSchema, { heavy: true });

    const [, init] = (global.fetch as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0];
    const requestBody = JSON.parse(init.body as string);
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(24000);
    expect(requestBody.reasoning.max_tokens).toBeLessThan(requestBody.max_tokens);
  });

  it("applies the reasoning-starvation recovery to grounded (web-search) calls too", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? openRouterResponse(lengthStarvedBody()) : openRouterResponse(okBody({ ok: true }));
    }) as unknown as typeof fetch;

    const { data } = await callAiJsonGrounded("system prompt", "user prompt", testSchema);
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});

describe("onEvent progress narration", () => {
  const originalKey = env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    env.OPENROUTER_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fires onEvent with a reasoning-retry narration on the length-starved retry path", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? openRouterResponse(lengthStarvedBody()) : openRouterResponse(okBody({ ok: true }));
    }) as unknown as typeof fetch;

    const events: string[] = [];
    const result = await callAiJson("system prompt", "user prompt", testSchema, {
      heavy: true,
      onEvent: (detail) => events.push(detail),
    });

    expect(result).toEqual({ ok: true });
    expect(events).toEqual(["Almost had it — asking for a cleaner draft"]);
  });

  it("fires onEvent with a validation-repair narration when the first reply fails schema validation", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? openRouterResponse(okBody({ nope: true })) : openRouterResponse(okBody({ ok: true }));
    }) as unknown as typeof fetch;

    const events: string[] = [];
    const result = await callAiJson("system prompt", "user prompt", testSchema, {
      onEvent: (detail) => events.push(detail),
    });

    expect(result).toEqual({ ok: true });
    expect(events).toEqual(["Polishing the draft"]);
  });

  it("never lets a throwing onEvent callback break the AI call", async () => {
    global.fetch = vi.fn(async () => openRouterResponse(okBody({ ok: true }))) as unknown as typeof fetch;

    const result = await callAiJson("system prompt", "user prompt", testSchema, {
      onEvent: () => {
        throw new Error("boom");
      },
    });

    expect(result).toEqual({ ok: true });
  });
});

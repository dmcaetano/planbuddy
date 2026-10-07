import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { callAiToolLoop } from "../../src/server/ai/deepseek.js";
import { env } from "../../src/server/env.js";

function res(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function toolTurn(name: string, args: unknown, id = "c1") {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: "",
          reasoning_details: [{ type: "reasoning.text", text: "thinking" }],
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

const tools = [{ name: "lookup", description: "d", parameters: { type: "object", properties: {} } }];

describe("callAiToolLoop", () => {
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

  it("runs a tool, feeds the result and reasoning back, and returns the finishing value", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(toolTurn("lookup", { q: "fish" })))
      .mockResolvedValueOnce(res(toolTurn("finish", { id: "x" }, "c2")));
    global.fetch = fetchMock as unknown as typeof fetch;
    const run = vi.fn((name: string) => (name === "finish" ? { output: "ok", done: { id: "x" } } : { output: { hits: 2 }, narration: "Looking" }));
    const events: string[] = [];
    const out = await callAiToolLoop({ system: "s", user: "u", tools, run, onEvent: (d) => events.push(d) });
    expect(out.done).toEqual({ id: "x" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["Looking"]);
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const assistant = second.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.reasoning_details).toBeDefined();
    expect(second.messages.some((m: { role: string }) => m.role === "tool")).toBe(true);
    expect(second.reasoning.effort).toBe("medium");
    expect(second.provider.require_parameters).toBe(true);
  });

  it("returns null when the model never calls the finishing tool", async () => {
    global.fetch = vi.fn().mockResolvedValue(res({ choices: [{ message: { content: "prose" } }] })) as unknown as typeof fetch;
    const out = await callAiToolLoop({ system: "s", user: "u", tools, run: () => ({ output: {} }) });
    expect(out.done).toBeNull();
  });

  it("throws on a provider error so the caller can fall back", async () => {
    global.fetch = vi.fn().mockResolvedValue(res({ error: "boom" }, 500)) as unknown as typeof fetch;
    await expect(callAiToolLoop({ system: "s", user: "u", tools, run: () => ({ output: {} }) })).rejects.toThrow(/OpenRouter error 500/);
  });
});

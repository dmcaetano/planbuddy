import { describe, expect, it } from "vitest";
import { safeJsonParse } from "../../src/server/ai/deepseek.js";

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

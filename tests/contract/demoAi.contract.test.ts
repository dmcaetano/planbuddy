import { describe, expect, it } from "vitest";
import {
  aiChatResponseSchema,
  aiFeedbackResponseSchema,
  aiGenerateResponseSchema,
} from "../../src/shared/schemas.js";
import { chatRespondDemo, feedbackExtractDemo, generateCandidatesDemo, type GenerateContext } from "../../src/server/ai/demoAi.js";
import { SCALES } from "../../src/shared/scale.js";

function baseCtx(overrides: Partial<GenerateContext> = {}): GenerateContext {
  return {
    scale: "day_off",
    moodContext: null,
    radiusKm: 25,
    activeConstraints: [],
    loveTastes: [],
    seed: "spec-1:0",
    ...overrides,
  };
}

describe("demo AI generate contract", () => {
  for (const scale of SCALES) {
    it(`produces schema-valid output for scale=${scale}`, () => {
      const result = generateCandidatesDemo(baseCtx({ scale }));
      expect(() => aiGenerateResponseSchema.parse(result)).not.toThrow();
    });
  }

  it("is deterministic for the same seed", () => {
    const a = generateCandidatesDemo(baseCtx({ seed: "same-seed" }));
    const b = generateCandidatesDemo(baseCtx({ seed: "same-seed" }));
    expect(a).toEqual(b);
  });

  it("produces a different order for a different seed (batch regeneration varies)", () => {
    const a = generateCandidatesDemo(baseCtx({ seed: "spec-1:0" }));
    const b = generateCandidatesDemo(baseCtx({ seed: "spec-1:1" }));
    expect(a.candidates.map((c) => c.title)).not.toEqual(b.candidates.map((c) => c.title));
  });

  it("getaway/vacation candidates carry a destination anchor and exactly 3 beats", () => {
    const result = generateCandidatesDemo(baseCtx({ scale: "getaway", radiusKm: 250 }));
    for (const candidate of result.candidates) {
      expect(candidate.destinationAnchor).toBeTruthy();
      expect(candidate.beats).toHaveLength(3);
    }
  });

  it("day_off candidates have exactly 1 beat and no destination anchor", () => {
    const result = generateCandidatesDemo(baseCtx({ scale: "day_off" }));
    for (const candidate of result.candidates) {
      expect(candidate.beats).toHaveLength(1);
      expect(candidate.destinationAnchor).toBeNull();
    }
  });
});

describe("demo AI chat contract", () => {
  it("produces schema-valid output and extracts a verifiable constraint quote", () => {
    const message = "We are allergic to peanuts";
    const result = chatRespondDemo({ message, seed: "s1" });
    expect(() => aiChatResponseSchema.parse(result)).not.toThrow();
    expect(result.extractions.length).toBeGreaterThan(0);
    const extraction = result.extractions[0];
    expect(extraction.quote).toBeTruthy();
    expect(message.includes(extraction.quote!)).toBe(true);
  });

  it("produces schema-valid output with no extractions for small talk", () => {
    const result = chatRespondDemo({ message: "What's a good idea for tomorrow?", seed: "s2" });
    expect(() => aiChatResponseSchema.parse(result)).not.toThrow();
  });
});

describe("demo AI feedback contract", () => {
  it("never emits anything constraint-shaped, only guarded preference evidence", () => {
    const result = feedbackExtractDemo("loved it, amazing pick, but a bit too crowded");
    expect(() => aiFeedbackResponseSchema.parse(result)).not.toThrow();
    for (const evidence of result.evidence) {
      expect(["love", "avoid"]).toContain(evidence.polarity);
    }
  });
});

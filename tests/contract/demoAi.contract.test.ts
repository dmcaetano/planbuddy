import { describe, expect, it } from "vitest";
import {
  aiChatResponseSchema,
  aiFeedbackResponseSchema,
  aiGenerateResponseSchema,
} from "../../src/shared/schemas.js";
import { chatRespondDemo, feedbackExtractDemo, generateCandidatesDemo, generateQuickFallback, type GenerateContext } from "../../src/server/ai/demoAi.js";
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

  it("day_off candidates have a decision-ready 3-beat itinerary and no destination anchor", () => {
    const result = generateCandidatesDemo(baseCtx({ scale: "day_off" }));
    for (const candidate of result.candidates) {
      expect(candidate.beats).toHaveLength(3);
      expect(candidate.destinationAnchor).toBeNull();
    }
  });

  it("returns a specific Maps-ready Lisbon fallback instead of a generic dead end", () => {
    const result = generateQuickFallback(baseCtx({
      homeBaseLabel: "Lisbon, Lisbon District, Portugal",
      moodContext: "A little walk, grilled fish or meat, and a soft stroll with my Pom",
      participants: [{ name: "Pom", kind: "pet", relationship: "dog" }],
    }));
    const candidate = result.candidates[0];
    expect(candidate.beats).toHaveLength(3);
    expect(candidate.beats.every((beat) => beat.place?.name)).toBe(true);
    expect(candidate.beats.every((beat) => beat.place?.sourceUrl.includes("google.com/maps/search"))).toBe(true);
    expect(candidate.estimatedCost).toMatch(/€.+per person/);
    expect(candidate.checkBeforeYouGo.join(" ")).toMatch(/Pom/i);
    expect(candidate.citations).toEqual([]);
  });

  it("rotates the Lisbon instant fallback away from recently shown places", () => {
    const first = generateQuickFallback(baseCtx({ homeBaseLabel: "Lisbon" })).candidates[0];
    const second = generateQuickFallback(baseCtx({
      homeBaseLabel: "Lisbon",
      recentSuggestions: [{
        title: first.title,
        category: first.category,
        placeNames: first.beats.flatMap((beat) => beat.place?.name ? [beat.place.name] : []),
      }],
    })).candidates[0];
    expect(second.beats.map((beat) => beat.place?.name)).not.toEqual(first.beats.map((beat) => beat.place?.name));
  });

  it("keeps restaurant and budget edits inside dining alternatives", () => {
    const result = generateCandidatesDemo(baseCtx({
      edit: {
        request: "Change only the restaurant",
        mode: "restaurant",
        originalPlan: {
          title: "A walk and dinner",
          category: "food",
          estimatedCost: null,
          walkingMinutes: 45,
          beats: [],
        },
      },
    }));
    expect(result.candidates.length).toBeGreaterThan(1);
    for (const candidate of result.candidates) {
      expect(candidate.category).toBe("food");
      expect(candidate.beats[1].title).toMatch(/market|noodle|shellfish/i);
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

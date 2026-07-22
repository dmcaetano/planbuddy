import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { canonicalizeCandidatePlaces, quickPlanQualityIssue } from "../../src/server/ai/index.js";
import { buildGenerateUserPrompt, buildPlaceResearchUserPrompt } from "../../src/server/ai/prompts.js";
import { composePlanWithGemini, researchPlacesWithGemini } from "../../src/server/grounding/geminiPlaces.js";
import { env } from "../../src/server/env.js";
import type { GenerateContext } from "../../src/server/ai/demoAi.js";
import type { AiGenerateResponse, AiPlaceResearchResponse } from "../../src/shared/schemas.js";

const canonical: AiPlaceResearchResponse["places"][number] = {
  name: "Saldanha Mar",
  address: "Rua Example, Lisboa",
  kind: "restaurant",
  sourceUrl: "https://source.example/verified-token",
  sourceLabel: "Verified source",
  factualNote: "A source-backed seafood restaurant.",
  bestFor: ["grilled fish"],
  photoSearchTerm: null,
};

const response: AiGenerateResponse = {
  candidates: [
    {
      title: "Grounded evening",
      rationale: "A compact fit.",
      category: "food",
      indoor: false,
      beats: [
        {
          title: "Dinner",
          description: "Eat grilled fish.",
          category: "food",
          indoor: false,
          place: { ...canonical, sourceUrl: "https://source.example/model-mutated-token" },
        },
      ],
      walkingDistanceKm: null,
      walkingMinutes: null,
      estimatedCost: null,
      checkBeforeYouGo: [],
      fallback: null,
      photoSearchTerm: null,
      destinationAnchor: null,
      resolverVenueIds: [],
      citations: [],
      constraintCompliance: [],
      travelEstimateKm: null,
    },
  ],
};

describe("grounded place canonicalization", () => {
  it("restores the server-held source payload when the composer mutates a URL", () => {
    const result = canonicalizeCandidatePlaces(response, [canonical]);
    expect(result.candidates[0].beats[0].place).toEqual({
      name: canonical.name,
      address: canonical.address,
      kind: canonical.kind,
      sourceUrl: canonical.sourceUrl,
      sourceLabel: canonical.sourceLabel,
      factualNote: canonical.factualNote,
    });
  });

  it("leaves unknown place names for the downstream firewall to reject", () => {
    const changed: AiGenerateResponse = structuredClone(response);
    changed.candidates[0].beats[0].place!.name = "Invented Lake";
    expect(canonicalizeCandidatePlaces(changed, [canonical]).candidates[0].beats[0].place?.name).toBe("Invented Lake");
  });
});

describe("grounded novelty prompts", () => {
  it("tells both discovery and composition to avoid previously surfaced places", () => {
    const context: GenerateContext = {
      scale: "weekend",
      homeBaseLabel: "Lisbon",
      moodContext: null,
      radiusKm: 60,
      activeConstraints: [],
      loveTastes: [],
      seed: "novelty",
      recentSuggestions: [{
        title: "An earlier day",
        category: "food",
        placeNames: ["Jardim Central", "Old Restaurant"],
      }],
    };
    expect(buildPlaceResearchUserPrompt(context)).toContain("Jardim Central");
    expect(buildGenerateUserPrompt(context)).toContain("Jardim Central");
  });
});

describe("fast-plan product quality gate", () => {
  const context: GenerateContext = {
    scale: "day_off",
    homeBaseLabel: "Lisbon, Portugal",
    moodContext: "A walk, grilled fish, and a soft stroll",
    radiusKm: 60,
    activeConstraints: [],
    loveTastes: [],
    seed: "quality-gate",
  };

  function fastResponse(names: string[], mealKind = "fish restaurant"): AiGenerateResponse {
    const candidate = structuredClone(response.candidates[0]);
    candidate.beats = names.map((name, index) => ({
      title: index === 1 ? `Grilled dinner at ${name}` : `Walk at ${name}`,
      description: index === 1 ? "Choose grilled fish." : "Take a gentle walk.",
      category: index === 1 ? "food" : "walk",
      indoor: index === 1,
      place: {
        ...canonical,
        name,
        kind: index === 1 ? mealKind : "garden",
        sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
      },
    }));
    return { candidates: [candidate] };
  }

  it("accepts a specific three-stop restaurant route", () => {
    expect(quickPlanQualityIssue(fastResponse(["Jardim A", "Peixaria B", "Miradouro C"]), context)).toBeNull();
  });

  it("rejects repeated stops, Lisbon lakes, and a generic food hall meal", () => {
    expect(quickPlanQualityIssue(fastResponse(["Cais do Sodré", "Peixaria B", "Cais do Sodré"]), context)).toMatch(/repeated/i);
    const lake = fastResponse(["Lakeside walk", "Peixaria B", "Miradouro C"]);
    lake.candidates[0].title = "Lisbon lakeside evening";
    expect(quickPlanQualityIssue(lake, context)).toMatch(/lake/i);
    expect(quickPlanQualityIssue(fastResponse(["Jardim A", "Time Out Market", "Miradouro C"], "food hall"), context)).toMatch(/restaurant/i);
  });
});

describe("Gemini 503 fails over fast without extra retries", () => {
  const originalKey = env.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  const minimalCtx: GenerateContext = {
    scale: "day_off",
    moodContext: null,
    radiusKm: 25,
    activeConstraints: [],
    loveTastes: [],
    seed: "gemini-outage-test",
  };

  beforeEach(() => {
    env.GEMINI_API_KEY = "test-gemini-key";
  });

  afterEach(() => {
    env.GEMINI_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("throws immediately on a 503 from place research -- exactly one HTTP call, no internal retry", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "UNAVAILABLE: high demand",
    })) as unknown as typeof fetch;

    await expect(researchPlacesWithGemini(minimalCtx)).rejects.toThrow(/503/);
    expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("throws immediately on a 503 from plan composition -- exactly one HTTP call, no internal retry", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "UNAVAILABLE: high demand",
    })) as unknown as typeof fetch;

    await expect(composePlanWithGemini(minimalCtx)).rejects.toThrow(/503/);
    expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});

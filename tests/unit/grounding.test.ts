import { describe, expect, it } from "vitest";
import { canonicalizeCandidatePlaces } from "../../src/server/ai/index.js";
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

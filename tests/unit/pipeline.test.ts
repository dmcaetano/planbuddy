import { describe, expect, it } from "vitest";
import { buildGroundedRestaurantSwap, findMealBeatIndex } from "../../src/server/plans/engine/pipeline.js";
import type { Candidate } from "../../src/shared/types.js";

describe("plan edit preservation", () => {
  it("identifies the actual dining stop when every beat inherits a food category", () => {
    expect(findMealBeatIndex([
      {
        category: "food",
        title: "Easy arrival walk",
        description: "Begin with a gentle walk near home.",
        place: null,
      },
      {
        category: "food",
        title: "Boardwalk and shellfish shack",
        description: "Walk the boardwalk, then share a bucket of steamed shellfish.",
        place: null,
      },
      {
        category: "stroll",
        title: "Soft after-plan stroll",
        description: "Finish with an easy loop.",
        place: null,
      },
    ])).toBe(1);
  });

  it("prefers a grounded restaurant place over a generic activity label", () => {
    expect(findMealBeatIndex([
      {
        category: "culture",
        title: "Museum visit",
        place: { name: "MAAT", kind: "museum" },
      },
      {
        category: "culture",
        title: "Relax nearby",
        place: { name: "O Frade", kind: "restaurant" },
      },
    ])).toBe(1);
  });

  it("uses the already-grounded meal fallback without changing the two route anchors", () => {
    const place = (name: string, kind: string) => ({
      name,
      address: `${name}, Lisbon`,
      kind,
      sourceUrl: `https://example.com/${name.toLowerCase().replaceAll(" ", "-")}`,
      sourceLabel: name,
      factualNote: `${name} is source-backed.`,
    });
    const original = {
      title: "Park, fish, and garden",
      rationale: "A coherent route.",
      category: "food",
      indoor: false,
      beats: [
        { title: "Park walk", description: "Walk in the park.", category: "walk", indoor: false, place: place("Park", "park") },
        { title: "Fish dinner", description: "Have dinner.", category: "food", indoor: true, place: place("First Fish", "restaurant") },
        { title: "Garden stroll", description: "Stroll in the garden.", category: "walk", indoor: false, place: place("Garden", "garden") },
      ],
      fallback: { title: "Nearby seafood dinner", description: "A second grilled-fish option.", place: place("Second Fish", "restaurant") },
      walkingDistanceKm: 3,
      walkingMinutes: 50,
      estimatedCost: "€30–40",
      checkBeforeYouGo: ["Reserve First Fish."],
      photoSearchTerm: "Park",
      heroImage: null,
      routeMapsUrl: null,
      preparation: null,
      destinationAnchor: null,
      travelEstimateKm: 2,
      citations: [],
      constraintCompliance: [],
    } as Candidate;

    const revised = buildGroundedRestaurantSwap(original);
    expect(revised?.beats[0].place?.name).toBe("Park");
    expect(revised?.beats[1].place?.name).toBe("Second Fish");
    expect(revised?.beats[2].place?.name).toBe("Garden");
    expect(revised?.fallback?.place?.name).toBe("First Fish");
    expect(revised?.checkBeforeYouGo[0]).toContain("Second Fish");
  });
});

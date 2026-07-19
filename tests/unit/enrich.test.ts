import { describe, expect, it } from "vitest";
import { enrichCandidate } from "../../src/server/plans/engine/enrich.js";
import type { AiCandidate } from "../../src/shared/schemas.js";

const candidate: AiCandidate = {
  title: "A real Lisbon evening",
  rationale: "A compact fit.",
  category: "food and stroll",
  indoor: false,
  beats: [
    {
      title: "Pre-dinner greenery",
      description: "Enjoy a gentle loop before dinner.",
      category: "nature",
      indoor: false,
      durationMinutes: 45,
      travelMode: "driving",
      place: {
        name: "Jardim da Praça do Império",
        address: "Praça do Império, Lisboa",
        kind: "public garden",
        sourceUrl: "https://www.lisboa.pt/example",
        sourceLabel: "Lisbon municipality",
        factualNote: "A municipal garden.",
      },
    },
    {
      title: "Dinner",
      description: "Choose grilled fish.",
      category: "food",
      indoor: false,
      travelMode: "walking",
      travelMinutes: 10,
      place: {
        name: "Example Restaurant",
        address: "Belém, Lisboa",
        kind: "restaurant",
        sourceUrl: "https://example.com",
        sourceLabel: "Official site",
        factualNote: "A restaurant listing.",
      },
    },
    {
      title: "Stroll",
      description: "Finish by the river.",
      category: "walk",
      indoor: false,
      durationMinutes: 45,
      travelMode: "walking",
      travelMinutes: 15,
      distanceFromPreviousKm: 1,
    },
  ],
  walkingDistanceKm: 3.2,
  walkingMinutes: 50,
  estimatedCost: "€35–50 per person",
  checkBeforeYouGo: [],
  fallback: null,
  photoSearchTerm: null,
  destinationAnchor: null,
  resolverVenueIds: [],
  citations: [],
  constraintCompliance: [],
  travelEstimateKm: 7,
};

describe("candidate enrichment", () => {
  it("builds server-owned Maps links and weather-aware human and pet kit", async () => {
    const enriched = await enrichCandidate(candidate, {
      homeBaseLabel: "Saldanha, Lisboa",
      participants: [
        {
          id: "pet-1",
          userId: "user-1",
          name: "Pom",
          kind: "pet",
          relationship: "Pomeranian",
          isOwner: false,
          createdAt: "2026-01-01",
        },
      ],
      weather: {
        temperatureC: 31,
        apparentTemperatureC: 33,
        precipitationProbability: 5,
        windSpeedKph: 18,
        uvIndex: 8,
        summary: "hot",
        unavailable: false,
      },
      walkingTargetMinutes: { min: 45, max: 60 },
    });

    expect(enriched.beats[0].place?.mapsUrl).toContain("google.com/maps/search");
    expect(enriched.beats[0].directionsUrl).toContain("origin=Saldanha");
    expect(enriched.beats[1].directionsUrl).toContain("Jardim");
    expect(enriched.routeMapsUrl).toContain("travelmode=walking");
    expect(enriched.preparation?.wear.join(" ")).toContain("breathable");
    expect(enriched.preparation?.pet.join(" ")).toContain("Collapsible bowl");
    expect(enriched.preparation?.weatherRule).toContain("skip the first walk");
    expect(enriched.walkingMinutes).toBe(60);
    expect(enriched.beats[0].durationMinutes! + enriched.beats[2].durationMinutes!).toBe(35);
    expect(enriched.checkBeforeYouGo.join(" ")).toMatch(/opening hours/i);
  });

  it("keeps the full route inside the remembered range when transfers consume most of it", async () => {
    const transferHeavy = structuredClone(candidate);
    transferHeavy.beats[0].travelMode = "walking";
    transferHeavy.beats[0].travelMinutes = 15;
    transferHeavy.beats[0].distanceFromPreviousKm = 1.1;
    transferHeavy.beats[1].travelMinutes = 15;
    transferHeavy.beats[1].distanceFromPreviousKm = 1.2;
    transferHeavy.beats[2].travelMinutes = 20;
    transferHeavy.beats[2].distanceFromPreviousKm = 1.5;

    const enriched = await enrichCandidate(transferHeavy, {
      homeBaseLabel: "Saldanha, Lisboa",
      participants: [],
      weather: {
        temperatureC: 25,
        precipitationProbability: 0,
        summary: "mild",
        unavailable: false,
      },
      walkingTargetMinutes: { min: 45, max: 60 },
    });

    expect(enriched.walkingMinutes).toBe(60);
    expect(enriched.beats[0].durationMinutes).toBe(5);
    expect(enriched.beats[2].durationMinutes).toBe(5);
  });
});

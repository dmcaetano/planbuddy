import { describe, expect, it } from "vitest";
import { buildPublicSnapshot } from "../../src/server/shares/repo.js";
import type { Candidate, PlanSpec, WeatherSnapshot } from "../../src/shared/types.js";

describe("public plan snapshots", () => {
  it("redacts private names case-insensitively without corrupting longer words", () => {
    const candidate = {
      title: "An evening with Pom",
      rationale: "Begin your evening with POM and enjoy yourself.",
      category: "food",
      indoor: false,
      beats: [{ title: "Walk with Pom", description: "Begin your walk.", category: "walk", indoor: false }],
      walkingDistanceKm: 2,
      walkingMinutes: 30,
      estimatedCost: null,
      checkBeforeYouGo: [],
      fallback: null,
      photoSearchTerm: null,
      heroImage: null,
      routeMapsUrl: null,
      preparation: null,
      destinationAnchor: null,
      travelEstimateKm: null,
      citations: [],
      constraintCompliance: [],
      scoreBreakdown: { groupFit: 1, feasibility: 1, novelty: 1, finalScore: 1, perParticipantFit: {} },
      rank: 1,
      rejected: false,
      rejectionReason: null,
      createdAt: "2026-07-19T00:00:00.000Z",
    } as Candidate;
    const spec = { startDate: "2026-07-25", endDate: "2026-07-25" } as PlanSpec;
    const weather = { summary: "Unavailable", unavailable: true, temperatureC: null, precipitationProbability: null } as WeatherSnapshot;

    const snapshot = buildPublicSnapshot(spec, candidate, weather, { mode: "inspiration", note: "Test" }, ["You", "Pom"]);
    expect(snapshot.candidate.rationale).toBe("Begin your evening with your group and enjoy yourself.");
    expect(snapshot.candidate.rationale).not.toContain("groupr");
    expect(snapshot.candidate.title).toBe("An evening with your group");
  });
});

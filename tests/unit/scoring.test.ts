import { describe, expect, it } from "vitest";
import {
  participantFit,
  groupFit,
  feasibility,
  novelty,
  scoreCandidates,
  pickDiverseAlternates,
  type ParticipantMemory,
} from "../../src/server/plans/engine/scoring.js";
import type { AiCandidate } from "../../src/shared/schemas.js";
import type { Taste, Hunch } from "../../src/shared/types.js";

function makeCandidate(overrides: Partial<AiCandidate> = {}): AiCandidate {
  return {
    title: "Morning hike",
    rationale: "A scenic hiking trail with a lookout.",
    category: "active",
    indoor: false,
    beats: [{ title: "Hike", description: "Hiking the ridge trail with great views.", category: "active", indoor: false }],
    destinationAnchor: null,
    resolverVenueIds: [],
    citations: [],
    constraintCompliance: [],
    travelEstimateKm: 10,
    ...overrides,
  };
}

function makeTaste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: "t1",
    userId: "u1",
    participantId: null,
    text: "loves hiking",
    polarity: "love",
    weight: 0.8,
    source: "stated",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("participantFit", () => {
  it("returns neutral 0.5 for a participant with no memory", () => {
    const fit = participantFit(makeCandidate(), { participantId: "p1", tastes: [], hunches: [] });
    expect(fit).toBe(0.5);
  });

  it("increases fit when a loved taste matches candidate text", () => {
    const memory: ParticipantMemory = { participantId: "p1", tastes: [makeTaste()], hunches: [] };
    const fit = participantFit(makeCandidate(), memory);
    expect(fit).toBeGreaterThan(0.5);
  });

  it("decreases fit when an avoided taste matches candidate text", () => {
    const memory: ParticipantMemory = {
      participantId: "p1",
      tastes: [makeTaste({ polarity: "avoid", text: "avoids hiking" })],
      hunches: [],
    };
    const fit = participantFit(makeCandidate(), memory);
    expect(fit).toBeLessThan(0.5);
  });

  it("clamps hunch contribution to at most ±0.15", () => {
    const hunch: Hunch = {
      id: "h1",
      userId: "u1",
      participantId: null,
      text: "hiking",
      polarity: "love",
      confidence: 1,
      evidenceCount: 3,
      plansSinceEvidence: 0,
      lastEvidenceAt: null,
      decayAt: "",
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const withHunch = participantFit(makeCandidate(), { participantId: "p1", tastes: [], hunches: [hunch] });
    expect(withHunch - 0.5).toBeLessThanOrEqual(0.15 + 1e-9);
  });

  it("ignores hunches that are not active", () => {
    const hunch: Hunch = {
      id: "h1",
      userId: "u1",
      participantId: null,
      text: "hiking",
      polarity: "love",
      confidence: 1,
      evidenceCount: 3,
      plansSinceEvidence: 0,
      lastEvidenceAt: null,
      decayAt: "",
      status: "dismissed",
      createdAt: "",
      updatedAt: "",
    };
    const fit = participantFit(makeCandidate(), { participantId: "p1", tastes: [], hunches: [hunch] });
    expect(fit).toBe(0.5);
  });
});

describe("groupFit (least misery)", () => {
  it("uses the minimum fit across participants", () => {
    const memories: ParticipantMemory[] = [
      { participantId: "a", tastes: [makeTaste()], hunches: [] },
      { participantId: "b", tastes: [makeTaste({ polarity: "avoid", text: "avoids hiking" })], hunches: [] },
    ];
    const { groupFit: gf, perParticipantFit } = groupFit(makeCandidate(), memories);
    expect(gf).toBe(Math.min(perParticipantFit.a, perParticipantFit.b));
    expect(gf).toBeLessThan(perParticipantFit.a);
  });

  it("is neutral when there are no participants", () => {
    expect(groupFit(makeCandidate(), []).groupFit).toBe(0.5);
  });
});

describe("feasibility", () => {
  it("penalizes outdoor candidates in high rain probability", () => {
    const dry = feasibility(makeCandidate(), { temperatureC: 20, precipitationProbability: 5, summary: "", unavailable: false }, 25);
    const wet = feasibility(makeCandidate(), { temperatureC: 20, precipitationProbability: 90, summary: "", unavailable: false }, 25);
    expect(wet).toBeLessThan(dry);
  });

  it("does not penalize indoor candidates for rain", () => {
    const indoorCandidate = makeCandidate({ indoor: true });
    const dry = feasibility(indoorCandidate, { temperatureC: 20, precipitationProbability: 5, summary: "", unavailable: false }, 25);
    const wet = feasibility(indoorCandidate, { temperatureC: 20, precipitationProbability: 90, summary: "", unavailable: false }, 25);
    expect(wet).toBe(dry);
  });

  it("penalizes travel distance beyond the radius", () => {
    const near = feasibility(makeCandidate({ travelEstimateKm: 10 }), null, 25);
    const far = feasibility(makeCandidate({ travelEstimateKm: 100 }), null, 25);
    expect(far).toBeLessThan(near);
  });
});

describe("novelty", () => {
  it("penalizes repeated categories from recent plans", () => {
    const fresh = novelty(makeCandidate(), []);
    const repeated = novelty(makeCandidate(), [{ title: "Something else", category: "active" }]);
    expect(repeated).toBeLessThan(fresh);
  });

  it("penalizes an exact title repeat more heavily", () => {
    const repeatedCategory = novelty(makeCandidate(), [{ title: "Different", category: "active" }]);
    const repeatedTitle = novelty(makeCandidate(), [{ title: "Morning hike", category: "active" }]);
    expect(repeatedTitle).toBeLessThan(repeatedCategory);
  });
});

describe("scoreCandidates", () => {
  it("ranks by final score with novelty breaking near ties, weighted 55/25/20", () => {
    const candidates = [makeCandidate({ title: "A" }), makeCandidate({ title: "B", category: "culture" })];
    const scored = scoreCandidates(candidates, [], null, 25, []);
    expect(scored).toHaveLength(2);
    for (const s of scored) {
      const expected = s.groupFit * 0.55 + s.feasibility * 0.25 + s.novelty * 0.2;
      expect(s.finalScore).toBeCloseTo(expected, 10);
    }
    expect(scored[0].finalScore).toBeGreaterThanOrEqual(scored[1].finalScore);
  });
});

describe("pickDiverseAlternates", () => {
  it("prefers alternates with a different category than the winner", () => {
    const scored = scoreCandidates(
      [
        makeCandidate({ title: "Winner", category: "active", travelEstimateKm: 5 }),
        makeCandidate({ title: "SameCategory", category: "active", travelEstimateKm: 6 }),
        makeCandidate({ title: "DifferentCategory", category: "culture", travelEstimateKm: 7 }),
      ],
      [],
      null,
      25,
      []
    );
    const alternates = pickDiverseAlternates(scored, 1);
    expect(alternates[0].candidate.category).not.toBe(scored[0].candidate.category);
  });
});

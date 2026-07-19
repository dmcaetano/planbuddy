import { describe, expect, it } from "vitest";
import { filterCandidates, type FilterContext } from "../../src/server/plans/engine/filter.js";
import { generateCandidatesDemo } from "../../src/server/ai/demoAi.js";
import type { AiCandidate } from "../../src/shared/schemas.js";

function makeCandidate(overrides: Partial<AiCandidate> = {}): AiCandidate {
  return {
    title: "Picnic in the park",
    rationale: "A calm afternoon outdoors.",
    category: "outdoors",
    indoor: false,
    beats: [{ title: "Picnic", description: "Pack a lunch and relax at the park.", category: "outdoors", indoor: false }],
    destinationAnchor: null,
    resolverVenueIds: [],
    citations: [],
    constraintCompliance: [],
    travelEstimateKm: 10,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    activeConstraints: [],
    knownFacts: new Map(),
    resolverMode: "inspiration",
    radiusKm: 25,
    isTripScale: false,
    ...overrides,
  };
}

describe("filterCandidates", () => {
  it("rejects a candidate whose text matches a constraint's blocked keywords", () => {
    const candidate = makeCandidate({
      title: "Thai peanut noodle crawl",
      rationale: "Featuring a peanut sauce noodle bar.",
    });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ activeConstraints: [{ id: "c1", text: "peanut allergy" }] }));
    expect(kept).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("constraint violation");
  });

  it("keeps a candidate that does not trip any constraint keyword", () => {
    const candidate = makeCandidate();
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ activeConstraints: [{ id: "c1", text: "peanut allergy" }] }));
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects indoor candidates when a constraint requires outdoor only", () => {
    const candidate = makeCandidate({ indoor: true });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ activeConstraints: [{ id: "c1", text: "must be outdoor only" }] }));
    expect(kept).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("rejects duplicate candidates by normalized title", () => {
    const a = makeCandidate({ title: "Museum Day" });
    const b = makeCandidate({ title: "museum day " });
    const { kept, rejected } = filterCandidates([a, b], baseCtx());
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe("duplicate candidate");
  });

  it("rejects a candidate citing an unknown fact id", () => {
    const candidate = makeCandidate({ citations: [{ factId: "missing", quote: "loves parks", source: "taste" }] });
    const { kept, rejected } = filterCandidates([candidate], baseCtx());
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toContain("invalid citation");
  });

  it("rejects a candidate whose citation quote is not actually in the cited fact", () => {
    const knownFacts = new Map([["t1", "loves museums"]]);
    const candidate = makeCandidate({ citations: [{ factId: "t1", quote: "loves hiking", source: "taste" }] });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ knownFacts }));
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toContain("invalid citation");
  });

  it("accepts a candidate with a valid citation matching a known fact", () => {
    const knownFacts = new Map([["t1", "loves parks and picnics"]]);
    const candidate = makeCandidate({ citations: [{ factId: "t1", quote: "loves parks", source: "taste" }] });
    const { kept } = filterCandidates([candidate], baseCtx({ knownFacts }));
    expect(kept).toHaveLength(1);
  });

  it("rejects candidates with an impossible travel radius for non-trip scales", () => {
    const candidate = makeCandidate({ travelEstimateKm: 500 });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ radiusKm: 25, isTripScale: false }));
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toBe("impossible radius");
  });

  it("does not apply the radius check for trip scales", () => {
    const candidate = makeCandidate({ travelEstimateKm: 5000 });
    const { kept } = filterCandidates([candidate], baseCtx({ radiusKm: 250, isTripScale: true }));
    expect(kept).toHaveLength(1);
  });

  it("applies the venue firewall: rejects resolver venue IDs with no live resolver payload", () => {
    const candidate = makeCandidate({ resolverVenueIds: ["venue-123"] });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ resolverMode: "inspiration" }));
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toContain("venue-firewall");
  });

  it("allows resolver venue IDs when the resolver is actually live", () => {
    const candidate = makeCandidate({ resolverVenueIds: ["venue-123"] });
    const { kept } = filterCandidates([candidate], baseCtx({ resolverMode: "resolved" }));
    expect(kept).toHaveLength(1);
  });
});

describe("filterCandidates against real demo AI output", () => {
  it("deterministically rejects the demo AI's peanut-noodle candidate for a peanut allergy constraint", () => {
    // The demo AI's local content pool draws 8 of 12 templates per seed, so
    // a single seed isn't guaranteed to surface the peanut-trigger template
    // (see tests/integration/plan.test.ts for why that integration test
    // asserts a weaker universal property instead). Here we search seeds
    // deterministically until it appears, then prove the real filter -- not
    // a hand-built fixture -- actually catches it end-to-end.
    let found: ReturnType<typeof generateCandidatesDemo> | null = null;
    for (let i = 0; i < 50; i++) {
      const result = generateCandidatesDemo({
        scale: "day_off",
        moodContext: null,
        radiusKm: 25,
        activeConstraints: [{ id: "c1", text: "peanut allergy" }],
        loveTastes: [],
        seed: `deterministic-seed-${i}`,
      });
      if (result.candidates.some((c) => /peanut/i.test(`${c.title} ${c.rationale}`))) {
        found = result;
        break;
      }
    }
    expect(found).not.toBeNull();

    const { kept, rejected } = filterCandidates(found!.candidates, {
      activeConstraints: [{ id: "c1", text: "peanut allergy" }],
      knownFacts: new Map(),
      resolverMode: "inspiration",
      radiusKm: 25,
      isTripScale: false,
    });

    expect(kept.every((c) => !/peanut/i.test(`${c.title} ${c.rationale}`))).toBe(true);
    const peanutRejection = rejected.find((r) => /peanut/i.test(`${r.candidate.title} ${r.candidate.rationale}`));
    expect(peanutRejection).toBeTruthy();
    expect(peanutRejection!.reason).toContain("constraint violation");
  });
});

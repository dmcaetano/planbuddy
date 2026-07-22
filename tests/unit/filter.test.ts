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

  it("does not mistake explicit gluten-safe language for a violation", () => {
    const candidate = makeCandidate({
      title: "Gluten-safe coastal picnic",
      rationale: "Pack a gluten-free lunch with gluten-free bread before a quiet shoreline walk.",
    });
    const { kept, rejected } = filterCandidates(
      [candidate],
      baseCtx({ activeConstraints: [{ id: "c1", text: "gluten intolerance" }] })
    );
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("still rejects an unsafe food mention for a gluten constraint", () => {
    const candidate = makeCandidate({ title: "Artisan bread and pasta tasting" });
    const { kept, rejected } = filterCandidates(
      [candidate],
      baseCtx({ activeConstraints: [{ id: "c1", text: "gluten intolerance" }] })
    );
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toContain("constraint violation");
  });

  it("does not treat uncrowded or explicit avoidance language as a noise violation", () => {
    const candidate = makeCandidate({
      title: "Uncrowded garden morning",
      rationale: "A quiet route that avoids loud, crowded indoor places.",
    });
    const { kept, rejected } = filterCandidates(
      [candidate],
      baseCtx({ activeConstraints: [{ id: "c1", text: "no loud places or crowds" }] })
    );
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

  it("drops an unknown memory citation without rejecting the plan", () => {
    const candidate = makeCandidate({ citations: [{ factId: "missing", quote: "loves parks", source: "taste" }] });
    const { kept, rejected } = filterCandidates([candidate], baseCtx());
    expect(kept).toHaveLength(1);
    expect(kept[0].citations).toEqual([]);
    expect(rejected).toHaveLength(0);
  });

  it("drops a citation whose quote is not actually in the cited fact", () => {
    const knownFacts = new Map([["t1", "loves museums"]]);
    const candidate = makeCandidate({ citations: [{ factId: "t1", quote: "loves hiking", source: "taste" }] });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ knownFacts }));
    expect(kept).toHaveLength(1);
    expect(kept[0].citations).toEqual([]);
    expect(rejected).toHaveLength(0);
  });

  it("accepts a candidate with a valid citation matching a known fact", () => {
    const knownFacts = new Map([["t1", "loves parks and picnics"]]);
    const candidate = makeCandidate({ citations: [{ factId: "t1", quote: "loves parks", source: "taste" }] });
    const { kept } = filterCandidates([candidate], baseCtx({ knownFacts }));
    expect(kept).toHaveLength(1);
  });

  it("strips an unresolvable memory-prefixed citation instead of rejecting the candidate", () => {
    const knownFacts = new Map([["t1", "loves parks and picnics"]]);
    const candidate = makeCandidate({
      citations: [
        { factId: "t1", quote: "loves parks", source: "taste" },
        { factId: "memory-234cf483", quote: "some prior conversation detail", source: "taste" },
      ],
    });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ knownFacts }));
    expect(rejected).toHaveLength(0);
    expect(kept).toHaveLength(1);
    expect(kept[0].citations).toEqual([{ factId: "t1", quote: "loves parks", source: "taste" }]);
  });

  it("also drops a fabricated non-memory citation id instead of blocking the plan", () => {
    const candidate = makeCandidate({ citations: [{ factId: "invented-fact", quote: "loves museums", source: "taste" }] });
    const { kept, rejected } = filterCandidates([candidate], baseCtx());
    expect(kept).toHaveLength(1);
    expect(kept[0].citations).toEqual([]);
    expect(rejected).toHaveLength(0);
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

  it("rejects a named place whose source URL was not returned by web grounding", () => {
    const candidate = makeCandidate({
      beats: [
        {
          title: "Dinner",
          description: "A specific dinner stop.",
          category: "food",
          indoor: false,
          place: {
            name: "Real Place",
            address: "Lisbon",
            kind: "restaurant",
            sourceUrl: "https://invented.example/place",
            sourceLabel: "Invented source",
            factualNote: "A terrace restaurant.",
          },
        },
      ],
    });
    const { kept, rejected } = filterCandidates(
      [candidate],
      baseCtx({ groundedSourceUrls: ["https://official.example/another-place"] })
    );
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toContain("place-source firewall");
  });

  it("keeps a Maps-ready named place when fast mode has no optional web dossier", () => {
    const candidate = makeCandidate({
      beats: [
        {
          title: "Dinner",
          description: "A specific dinner stop to verify in Maps.",
          category: "food",
          indoor: false,
          place: {
            name: "Real Place",
            address: "Lisbon",
            kind: "restaurant",
            sourceUrl: "https://www.google.com/maps/search/?api=1&query=Real+Place+Lisbon",
            sourceLabel: "Google Maps",
            factualNote: "Open the live listing to confirm current details.",
          },
        },
      ],
    });
    const { kept, rejected } = filterCandidates([candidate], baseCtx({ groundedSourceUrls: [] }));
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("accepts a named place when its source URL matches web-search evidence", () => {
    const sourceUrl = "https://www.visitlisboa.com/en/places/example/";
    const candidate = makeCandidate({
      beats: [
        {
          title: "Dinner",
          description: "A grounded dinner stop.",
          category: "food",
          indoor: false,
          place: {
            name: "Example",
            address: "Lisbon",
            kind: "restaurant",
            sourceUrl,
            sourceLabel: "Visit Lisboa",
            factualNote: "A listed Lisbon restaurant.",
          },
        },
      ],
    });
    const { kept } = filterCandidates(
      [candidate],
      baseCtx({ groundedSourceUrls: ["https://www.visitlisboa.com/en/places/example"] })
    );
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

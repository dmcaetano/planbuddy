import { describe, expect, it } from "vitest";
import { findMealBeatIndex } from "../../src/server/plans/engine/pipeline.js";

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
});

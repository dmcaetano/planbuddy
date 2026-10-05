import { describe, expect, it } from "vitest";
import { buildCatalogCandidate, buildCatalogCandidateWithMatch } from "../../src/server/plans/engine/catalogPlanner.js";
import { quickPlanQualityIssue } from "../../src/server/ai/index.js";
import { buildGenerateSystemPrompt, buildGenerateUserPrompt } from "../../src/server/ai/prompts.js";
import type { GenerateContext } from "../../src/server/ai/demoAi.js";
import type { ResolvedVenue } from "../../src/server/resolver/placeResolver.js";
import type { AiGenerateResponse } from "../../src/shared/schemas.js";
import { clockToMinutes, momentTimes, resolveMoment } from "../../src/shared/moment.js";
import { buildMomentMood, toStoredTimes } from "../../src/server/moment/mood.js";

function venue(
  id: string,
  name: string,
  category: ResolvedVenue["category"],
  lat: number,
  lng: number,
  subcategory = category === "food" ? "restaurant" : "park",
  tags: string[] = []
): ResolvedVenue {
  return {
    id,
    name,
    category,
    subcategory,
    lat,
    lng,
    openNow: null,
    sourceUrl: `https://www.openstreetmap.org/${id}`,
    address: `${name} address`,
    tags: [subcategory, ...tags],
  };
}

// One compact cluster only, so the planner has exactly one possible route and the assertions are exact.
const cluster: ResolvedVenue[] = [
  venue("node/1", "Maré Alta", "food", 38.722, -9.139, "restaurant", ["seafood", "portuguese"]),
  venue("node/2", "Jardim Azul", "outdoor", 38.724, -9.142, "garden"),
  venue("node/3", "Miradouro Claro", "outdoor", 38.719, -9.135, "viewpoint"),
];

function momentContext(iso: string, opts: { romantic?: boolean; kind?: "tonight" | "day"; loves?: GenerateContext["loveTastes"] } = {}): GenerateContext {
  const moment = resolveMoment(iso);
  const times = momentTimes(moment.kind, moment.planDate, iso);
  const stored = toStoredTimes(times, opts.romantic ?? false);
  return {
    scale: "day_off",
    homeBaseLabel: "Lisbon",
    homeBaseLat: 38.7223,
    homeBaseLng: -9.1393,
    participants: [{ name: "You", kind: "person", relationship: null }],
    moodContext: buildMomentMood(moment, times, opts.romantic ?? false),
    radiusKm: 25,
    activeConstraints: [],
    loveTastes: opts.loves ?? [],
    recentSuggestions: [],
    seed: "moment:1",
    moment: {
      kind: moment.kind,
      startTime: stored.startTime,
      mealFirst: stored.mealFirst,
      mealStart: stored.mealStart,
      romantic: stored.romantic,
      lateMealFirst: stored.lateMealFirst,
      firstStopMinutes: stored.firstStopMinutes,
    },
  };
}

describe("catalogue planner with a moment (spec rule 4)", () => {
  it("meal second: the first stop is lengthened so the meal lands in 19:00-21:00", () => {
    const candidate = buildCatalogCandidate(momentContext("2026-10-09T14:00"), cluster)!;
    expect(candidate.beats).toHaveLength(3);
    expect(candidate.beats[0].startTime).toBe("16:30");
    expect(candidate.beats[0].durationMinutes).toBe(150);
    expect(candidate.beats[1].place?.kind).toBe("restaurant");
    expect(candidate.beats[1].startTime).toBe("19:00");
    const third = clockToMinutes(candidate.beats[2].startTime)!;
    expect(third).toBeGreaterThan(clockToMinutes("20:30")!);
    expect(new Set(candidate.beats.map((beat) => beat.place?.name)).size).toBe(3);
  });

  it("meal first: the meal is beat 1, then the two nearby stops, with the late-start note", () => {
    const candidate = buildCatalogCandidate(momentContext("2026-10-09T20:59"), cluster)!;
    expect(candidate.beats).toHaveLength(3);
    expect(candidate.beats[0].place?.kind).toBe("restaurant");
    expect(candidate.beats[0].place?.name).toBe("Maré Alta");
    expect(candidate.beats[0].startTime).toBe("21:30");
    const second = clockToMinutes(candidate.beats[1].startTime)!;
    const third = clockToMinutes(candidate.beats[2].startTime)!;
    expect(second).toBeGreaterThan(clockToMinutes("21:30")!);
    expect(third).toBeGreaterThan(second);
    expect(new Set(candidate.beats.map((beat) => beat.place?.name)).size).toBe(3);
    expect(candidate.checkBeforeYouGo.join(" ")).toMatch(/late start/i);
    expect(candidate.checkBeforeYouGo.join(" ")).toMatch(/opening hours/i);
    expect(candidate.title.startsWith("Maré Alta")).toBe(true);
  });

  it("day: lunch second at 10:00 or first at 12:00", () => {
    const early = buildCatalogCandidate(momentContext("2026-10-10T06:30"), cluster)!;
    expect(early.beats[0].startTime).toBe("10:00");
    expect(early.beats[1].place?.kind).toBe("restaurant");
    expect(early.beats[1].startTime).toBe("12:00");
    const late = buildCatalogCandidate(momentContext("2026-10-10T11:00"), cluster)!;
    expect(late.beats[0].place?.kind).toBe("restaurant");
    expect(late.beats[0].startTime).toBe("12:00");
  });

  it("uses the romantic wording only when asked, and neutral wording otherwise", () => {
    const romantic = buildCatalogCandidate(momentContext("2026-10-09T14:00", { romantic: true }), cluster)!;
    expect(romantic.rationale).toMatch(/romantic evening/i);
    const neutral = buildCatalogCandidate(momentContext("2026-10-09T14:00"), cluster)!;
    expect(neutral.rationale).not.toMatch(/romantic/i);
    expect(neutral.rationale).toContain("mapped places");
  });

  it("reports the matched love taste, and null when nothing fits", () => {
    const withFish = buildCatalogCandidateWithMatch(
      momentContext("2026-10-09T14:00", { loves: [
        { id: "t-bike", text: "mountain biking", source: "taste" },
        { id: "t-fish", text: "fresh grilled fish", source: "taste" },
      ] }),
      cluster
    )!;
    expect(withFish.matchedTasteId).toBe("t-fish");
    const none = buildCatalogCandidateWithMatch(
      momentContext("2026-10-09T14:00", { loves: [{ id: "t-bike", text: "mountain biking", source: "taste" }] }),
      cluster
    )!;
    expect(none.matchedTasteId).toBeNull();
    const noTastes = buildCatalogCandidateWithMatch(momentContext("2026-10-09T14:00"), cluster)!;
    expect(noTastes.matchedTasteId).toBeNull();
  });

  it("without a moment the output is the unchanged three-beat shape", () => {
    const ctx = momentContext("2026-10-09T14:00");
    delete ctx.moment;
    ctx.moodContext = "A walk and a healthy grilled fish meal";
    const candidate = buildCatalogCandidate(ctx, cluster)!;
    expect(candidate.beats.map((beat) => beat.startTime)).toEqual(["11:30", "13:00", "14:40"]);
    expect(candidate.beats[1].place?.kind).toBe("restaurant");
    expect(candidate.rationale).toMatch(/^A fresh, geographically compact route/);
  });
});

describe("quality gate with a meal-first moment (spec rule 4)", () => {
  function response(order: ("meal" | "stop")[]): AiGenerateResponse {
    return {
      candidates: [
        {
          title: "Evening",
          rationale: "A compact fit.",
          category: "food",
          indoor: false,
          beats: order.map((role, index) => ({
            title: role === "meal" ? "Dinner" : `Stop ${index}`,
            description: role === "meal" ? "Eat well." : "Take a gentle walk.",
            category: role === "meal" ? "food" : "walk",
            indoor: role === "meal",
            place: {
              name: `Place ${index}`,
              address: null,
              kind: role === "meal" ? "restaurant" : "garden",
              sourceUrl: `https://www.google.com/maps/search/?api=1&query=${index}`,
              sourceLabel: "Google Maps",
              factualNote: "Confirm the listing.",
            },
          })),
          resolverVenueIds: [],
          citations: [],
          constraintCompliance: [],
          checkBeforeYouGo: [],
        },
      ],
    } as AiGenerateResponse;
  }

  it("accepts the meal at index 0 only when the moment is meal-first", () => {
    const mealFirstCtx = momentContext("2026-10-09T20:00");
    expect(mealFirstCtx.moment?.mealFirst).toBe(true);
    expect(quickPlanQualityIssue(response(["meal", "stop", "stop"]), mealFirstCtx)).toBeNull();
    expect(quickPlanQualityIssue(response(["stop", "meal", "stop"]), mealFirstCtx)).toMatch(/not a specific restaurant/i);
  });

  it("keeps the existing meal-second rule for every other kind", () => {
    const second = momentContext("2026-10-09T14:00");
    expect(second.moment?.mealFirst).toBe(false);
    expect(quickPlanQualityIssue(response(["stop", "meal", "stop"]), second)).toBeNull();
    expect(quickPlanQualityIssue(response(["meal", "stop", "stop"]), second)).toMatch(/not a specific restaurant/i);
    const legacy = { ...second, moment: undefined };
    expect(quickPlanQualityIssue(response(["stop", "meal", "stop"]), legacy)).toBeNull();
  });
});

describe("fast plan prompt hint", () => {
  it("adds timing, order and neutral or romantic framing only for a moment", () => {
    const meal = momentContext("2026-10-09T20:00");
    const prompt = buildGenerateUserPrompt(meal, true);
    expect(prompt).toContain("Moment timing: the first beat starts at");
    expect(prompt).toContain("the meal is beat 1");
    expect(prompt).toContain("keep the wording neutral");
    expect(buildGenerateSystemPrompt(meal, true)).toContain("the meal is the FIRST beat");
    const romantic = buildGenerateUserPrompt(momentContext("2026-10-09T14:00", { romantic: true }), true);
    expect(romantic).toContain("romantic evening for two");
    expect(romantic).toContain("Beat order: stop, meal, stop");
    const plain = { ...meal, moment: undefined };
    expect(buildGenerateUserPrompt(plain, true)).not.toContain("Moment timing");
    expect(buildGenerateSystemPrompt(plain, true)).not.toContain("FIRST beat");
  });
});

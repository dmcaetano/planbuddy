import { describe, expect, it } from "vitest";
import {
  buildNudgeLine,
  citableLoveTastes,
  formatRange,
  selectNudgeRange,
  tasteFitsRange,
} from "../../src/server/timeoff/nudge.js";
import { buildIdeasSchema, makesPriceClaim, namedInRecentPlans } from "../../src/server/timeoff/tripIdeas.js";
import { buildGenerateUserPrompt } from "../../src/server/ai/prompts.js";
import type { TimeOff } from "../../src/shared/momentTypes.js";

function range(label: string, startDate: string, endDate: string, snoozedUntil: string | null = null): TimeOff {
  return { id: label, label, startDate, endDate, snoozedUntil };
}

describe("season guard (acceptance 12)", () => {
  it("cites a snow taste for December and not for July", () => {
    expect(tasteFitsRange("loves snow", "2026-12-24", "2026-12-31")).toBe(true);
    expect(tasteFitsRange("loves snow", "2027-07-10", "2027-07-20")).toBe(false);
    expect(tasteFitsRange("loves skiing", "2027-03-30", "2027-04-05")).toBe(true);
    expect(tasteFitsRange("loves skiing", "2027-04-02", "2027-04-09")).toBe(false);
  });

  it("cites beach and swim tastes only from June to September", () => {
    expect(tasteFitsRange("loves the beach", "2027-07-01", "2027-07-05")).toBe(true);
    expect(tasteFitsRange("loves the beach", "2026-12-24", "2026-12-31")).toBe(false);
    expect(tasteFitsRange("Swimming in the sea", "2027-05-28", "2027-06-02")).toBe(true);
    expect(tasteFitsRange("Swimming in the sea", "2027-10-01", "2027-10-09")).toBe(false);
  });

  it("matches whole words only and leaves other tastes alone", () => {
    expect(tasteFitsRange("loves the season finale", "2026-12-24", "2026-12-31")).toBe(true);
    expect(tasteFitsRange("loves seafood", "2026-12-24", "2026-12-31")).toBe(true);
    expect(tasteFitsRange("loves live music", "2027-07-10", "2027-07-20")).toBe(true);
  });

  it("citableLoveTastes drops out-of-season and non-love tastes, strongest first", () => {
    const tastes = [
      { id: "1", text: "loves snow", polarity: "love" as const, weight: 0.9 },
      { id: "2", text: "loves live music", polarity: "love" as const, weight: 0.5 },
      { id: "3", text: "avoids crowds", polarity: "avoid" as const, weight: 1 },
      { id: "4", text: "loves quiet villages", polarity: "love" as const, weight: 0.8 },
    ];
    expect(citableLoveTastes(tastes, { startDate: "2027-07-10", endDate: "2027-07-20" }).map((t) => t.id)).toEqual(["4", "2"]);
    expect(citableLoveTastes(tastes, { startDate: "2026-12-24", endDate: "2026-12-31" }).map((t) => t.id)).toEqual(["1", "4", "2"]);
  });
});

describe("nudge selection (spec rules 18, 23)", () => {
  const today = "2026-10-07";

  it("picks the earliest range that has not ended", () => {
    const ranges = [range("Later", "2026-12-20", "2026-12-22"), range("Past", "2026-09-01", "2026-09-05"), range("Sooner", "2026-11-01", "2026-11-03")];
    expect(selectNudgeRange(ranges, today, [])?.label).toBe("Sooner");
  });

  it("keeps a range that is under way and drops one that ended yesterday", () => {
    expect(selectNudgeRange([range("Now", "2026-10-05", "2026-10-09")], today, [])?.label).toBe("Now");
    expect(selectNudgeRange([range("Over", "2026-10-01", "2026-10-06")], today, [])).toBeNull();
    expect(selectNudgeRange([range("Today", "2026-10-07", "2026-10-07")], today, [])?.label).toBe("Today");
  });

  it("only considers ranges starting within 183 days", () => {
    // 2026-10-07 + 183 days = 2027-04-08
    expect(selectNudgeRange([range("Edge", "2027-04-08", "2027-04-12")], today, [])?.label).toBe("Edge");
    expect(selectNudgeRange([range("Past edge", "2027-04-09", "2027-04-12")], today, [])).toBeNull();
  });

  it("hides a snoozed range until the snooze date has passed", () => {
    const snoozed = range("Trip", "2026-12-24", "2026-12-31", "2026-10-14");
    expect(selectNudgeRange([snoozed], "2026-10-13", [])).toBeNull();
    expect(selectNudgeRange([snoozed], "2026-10-14", [])).toBeNull();
    expect(selectNudgeRange([snoozed], "2026-10-15", [])?.label).toBe("Trip");
  });

  it("is removed by an overlapping locked trip but not by a non-overlapping one", () => {
    const trip = range("Trip", "2026-12-24", "2026-12-31");
    expect(selectNudgeRange([trip], today, [{ startDate: "2026-12-31", endDate: "2027-01-03" }])).toBeNull();
    expect(selectNudgeRange([trip], today, [{ startDate: "2026-12-20", endDate: "2026-12-23" }])?.label).toBe("Trip");
    expect(selectNudgeRange([trip], today, [{ startDate: "2027-01-01", endDate: "2027-01-03" }])?.label).toBe("Trip");
  });

  it("moves on to the next range when the first is covered by a locked trip", () => {
    const ranges = [range("A", "2026-11-01", "2026-11-05"), range("B", "2026-12-24", "2026-12-31")];
    expect(selectNudgeRange(ranges, today, [{ startDate: "2026-11-02", endDate: "2026-11-04" }])?.label).toBe("B");
  });
});

describe("nudge line", () => {
  it("is built from the label, the dates and one taste quoted as stored", () => {
    const trip = range("Christmas", "2026-12-24", "2026-12-31");
    expect(buildNudgeLine(trip, { text: "loves snow" }, "2026-10-07")).toBe("Christmas: Dec 24 to Dec 31 · fits “loves snow”");
    expect(buildNudgeLine(trip, null, "2026-10-07")).toBe("Christmas: Dec 24 to Dec 31");
  });

  it("adds the year when the range is not in the current year, and handles a single day", () => {
    expect(formatRange("2027-01-02", "2027-01-05", "2026-10-07")).toBe("Jan 2, 2027 to Jan 5, 2027");
    expect(formatRange("2026-12-24", "2026-12-24", "2026-10-07")).toBe("Dec 24");
  });
});

describe("trip idea guardrails (spec rule 19)", () => {
  it("rejects price, flight and availability claims", () => {
    for (const text of [
      "Flights are cheap in December",
      "Around €400 for a week",
      "$300 per night",
      "Great prices off season",
      "Rooms are available",
      "Book early for the best deals",
      "Costs less than you think",
      "Return fare from 80 EUR",
    ]) {
      expect(makesPriceClaim(text), text).toBe(true);
    }
    for (const text of ["Snowy peaks and cosy mountain villages.", "A walkable old town with long lunches."]) {
      expect(makesPriceClaim(text), text).toBe(false);
    }
  });

  it("detects a destination already in the recent plans", () => {
    const recent = "Weekend in Évora [{\"place\":{\"name\":\"Praça do Giraldo\"}}]\nDay out in Sintra";
    expect(namedInRecentPlans("Evora", recent)).toBe(true);
    expect(namedInRecentPlans("sintra", recent)).toBe(true);
    expect(namedInRecentPlans("Vienna", recent)).toBe(false);
  });

  it("the schema rejects a price claim, a repeated farther destination and identical ideas", () => {
    const schema = buildIdeasSchema("Day out in Sintra", ["Douro Valley"]);
    const good = {
      local: { name: "Serra da Estrela", reason: "Mountain air and slow village lunches." },
      farther: { name: "Vienna", reason: "Grand cafes and winter concerts." },
    };
    expect(schema.safeParse(good).success).toBe(true);
    expect(schema.safeParse({ ...good, farther: { ...good.farther, reason: "Cheap flights in December." } }).success).toBe(false);
    expect(schema.safeParse({ ...good, local: { ...good.local, reason: "Only 50 euros a night." } }).success).toBe(false);
    expect(schema.safeParse({ ...good, farther: { name: "Sintra", reason: "Palaces and misty woods." } }).success).toBe(false);
    expect(schema.safeParse({ ...good, farther: { ...good.local } }).success).toBe(false);
    expect(schema.safeParse({ ...good, local: { name: "Douro Valley", reason: "Terraced vineyards." } }).success).toBe(false);
    expect(schema.safeParse({ local: good.local }).success).toBe(false);
  });
});

describe("trip prompt destination hint", () => {
  const base = {
    scale: "getaway" as const,
    startDate: "2026-12-24",
    endDate: "2026-12-31",
    homeBaseLabel: "Lisbon",
    homeBaseLat: null,
    homeBaseLng: null,
    radiusKm: 250,
    weather: null,
    activeConstraints: [],
    loveTastes: [],
    avoidTastes: [],
    hunches: [],
    recentSuggestions: [],
    participants: [],
    seed: "x",
  };

  it("adds a Destination requested line only for a trip idea on a trip scale", () => {
    const withIdea = buildGenerateUserPrompt({ ...base, moodContext: "Trip idea: Serra da Estrela" } as never);
    expect(withIdea).toContain("Destination requested: Serra da Estrela");
    const without = buildGenerateUserPrompt({ ...base, moodContext: "something cosy" } as never);
    expect(without).not.toContain("Destination requested");
    const local = buildGenerateUserPrompt({ ...base, scale: "day_off", moodContext: "Trip idea: Serra da Estrela" } as never);
    expect(local).not.toContain("Destination requested");
  });
});

import { describe, expect, it } from "vitest";
import { computeInputsFingerprint } from "../../src/server/moment/fingerprint.js";
import { isRomanticGroup } from "../../src/server/moment/romantic.js";
import { buildReasonLine, buildReasonParts, pickTasteByOverlap } from "../../src/server/moment/reason.js";
import { firstBeatStarted, lastBeatEnded, retimeBeatsForMoment } from "../../src/server/moment/retime.js";
import { buildMomentMood } from "../../src/server/moment/mood.js";
import { momentTimes, resolveMoment } from "../../src/shared/moment.js";
import type { Beat, Constraint, Participant } from "../../src/shared/types.js";

function person(id: string, name: string, relationship: string | null, extra: Partial<Participant> = {}): Participant {
  return { id, userId: "u1", name, kind: "person", relationship, isOwner: false, createdAt: "", ...extra };
}
const owner = person("p-owner", "You", null, { isOwner: true });
const wife = person("p-wife", "Dani", "wife");
const dog: Participant = { ...person("p-dog", "Pom", "dog"), kind: "pet" };

function constraint(id: string, text: string, participantId: string | null = null): Constraint {
  return {
    id, userId: "u1", participantId, text, status: "verified", source: "typed",
    sourceQuote: null, sourceMessageId: null, createdAt: "", updatedAt: "",
  };
}

describe("inputs fingerprint (spec rule 5)", () => {
  const base = computeInputsFingerprint([owner, wife], [constraint("c1", "peanut allergy")]);

  it("is stable for the same inputs regardless of order or names", () => {
    expect(computeInputsFingerprint([wife, owner], [constraint("c1", "peanut allergy")])).toBe(base);
    expect(computeInputsFingerprint([owner, { ...wife, name: "Daniela" }], [constraint("c1", "peanut allergy")])).toBe(base);
  });

  it("changes with a new constraint, a relationship, or a person added or removed", () => {
    expect(computeInputsFingerprint([owner, wife], [constraint("c1", "peanut allergy"), constraint("c2", "no shellfish")])).not.toBe(base);
    expect(computeInputsFingerprint([owner, { ...wife, relationship: "partner" }], [constraint("c1", "peanut allergy")])).not.toBe(base);
    expect(computeInputsFingerprint([owner, { ...wife, relationship: null }], [constraint("c1", "peanut allergy")])).not.toBe(base);
    expect(computeInputsFingerprint([owner, wife, dog], [constraint("c1", "peanut allergy")])).not.toBe(base);
    expect(computeInputsFingerprint([owner], [constraint("c1", "peanut allergy")])).not.toBe(base);
  });
});

describe("romantic framing (spec rule 12)", () => {
  it("owner + one local partner-word person on a tonight moment", () => {
    expect(isRomanticGroup([owner, wife], "tonight")).toBe(true);
    expect(isRomanticGroup([owner, wife, dog], "tonight")).toBe(true); // pets are ignored
  });

  it("is neutral for other kinds, unset or non-partner relationships, and bigger groups", () => {
    expect(isRomanticGroup([owner, wife], "day")).toBe(false);
    expect(isRomanticGroup([owner, wife], "weekend")).toBe(false);
    expect(isRomanticGroup([owner, { ...wife, relationship: null }], "tonight")).toBe(false);
    expect(isRomanticGroup([owner, { ...wife, relationship: "friend" }], "tonight")).toBe(false);
    expect(isRomanticGroup([owner, wife, person("p-x", "Rui", "brother")], "tonight")).toBe(false);
    expect(isRomanticGroup([owner], "tonight")).toBe(false);
    expect(isRomanticGroup([owner, dog], "tonight")).toBe(false);
  });

  it("a connected friend account never triggers it, even with a partner word", () => {
    const friend = person("p-friend", "Sam", "wife", { isFriendAccount: true });
    expect(isRomanticGroup([owner, friend], "tonight")).toBe(false);
    expect(isRomanticGroup([owner, wife, friend], "tonight")).toBe(false);
  });
});

describe("reason parts and line (spec rule 11)", () => {
  const forecast = {
    temperatureC: 18, precipitationProbability: 10, summary: "mild, 18°C, mostly dry", unavailable: false,
  };

  it("builds the moment, people (names or relationship words), taste and weather", () => {
    const parts = buildReasonParts({
      momentLabel: "Friday evening",
      participants: [dog, wife, owner],
      romantic: false,
      taste: { id: "t1", text: "grilled fish" },
      weather: forecast,
    });
    expect(parts.people).toEqual(["you", "Pom", "your wife"]);
    expect(parts.peopleIds).toEqual(["p-owner", "p-dog", "p-wife"]);
    expect(parts.taste).toEqual({ id: "t1", text: "grilled fish" });
    expect(parts.weather).toBe("mild, 18°C, mostly dry");
    const line = buildReasonLine(parts);
    expect(line).toContain("Friday evening for you, Pom and your wife");
    expect(line).toContain("“grilled fish”");
    expect(line).toContain("mild, 18°C, mostly dry");
    expect(line).not.toMatch(/romantic/i);
  });

  it("omits a part that has no source", () => {
    const parts = buildReasonParts({
      momentLabel: "This weekend",
      participants: [owner],
      romantic: false,
      taste: null,
      weather: { ...forecast, unavailable: true, summary: "Weather unavailable" },
    });
    expect(parts.taste).toBeNull();
    expect(parts.weather).toBeNull();
    expect(buildReasonLine(parts)).toBe("This weekend for you");
  });

  it("says romantic evening only when the flag is set", () => {
    const parts = buildReasonParts({
      momentLabel: "Friday evening", participants: [owner, wife], romantic: true, taste: null, weather: null,
    });
    expect(buildReasonLine(parts)).toContain("romantic evening");
  });

  it("picks the taste by deterministic overlap and omits it when none overlaps", () => {
    const tastes = [
      { id: "t-bike", text: "mountain biking" },
      { id: "t-fish", text: "fresh grilled fish" },
    ];
    expect(pickTasteByOverlap(tastes, "Dinner at a seafood place: grilled fish and a river walk")?.id).toBe("t-fish");
    expect(pickTasteByOverlap(tastes, "A museum and a quiet garden")).toBeNull();
    expect(pickTasteByOverlap([], "grilled fish")).toBeNull();
  });
});

describe("retiming in place (spec rule 6)", () => {
  const beats: Beat[] = [
    { title: "Start gently at Jardim Azul", description: "Easy loop.", category: "walk", indoor: false, startTime: "16:30", durationMinutes: 150, travelMinutes: 10, place: { name: "Jardim Azul", kind: "garden", sourceUrl: "https://x/1", sourceLabel: "OSM", factualNote: "n" }, directionsUrl: "https://maps/1" },
    { title: "Meal at Mare Alta", description: "Dinner.", category: "food", indoor: true, startTime: "19:00", durationMinutes: 90, travelMinutes: 8, distanceFromPreviousKm: 0.6, place: { name: "Mare Alta", kind: "restaurant", sourceUrl: "https://x/2", sourceLabel: "OSM", factualNote: "n" }, directionsUrl: "https://maps/2" },
    { title: "Soft finish at Miradouro", description: "Stroll.", category: "stroll", indoor: false, startTime: "20:40", durationMinutes: 25, travelMinutes: 6, place: { name: "Miradouro", kind: "viewpoint", sourceUrl: "https://x/3", sourceLabel: "OSM", factualNote: "n" }, directionsUrl: "https://maps/3" },
  ];
  const timesAt = (iso: string) => {
    const moment = resolveMoment(iso);
    return { moment, times: momentTimes(moment.kind, moment.planDate, iso) };
  };

  it("detects a first beat that has already started, only on the plan date", () => {
    expect(firstBeatStarted(beats, "2026-10-09", "2026-10-09T20:30")).toBe(true);
    expect(firstBeatStarted(beats, "2026-10-09", "2026-10-09T16:00")).toBe(false);
    expect(firstBeatStarted(beats, "2026-10-10", "2026-10-09T20:30")).toBe(false);
  });

  it("detects whether the last beat has ended", () => {
    expect(lastBeatEnded(beats, "2026-10-09T21:30")).toBe(true);
    expect(lastBeatEnded(beats, "2026-10-09T21:04")).toBe(false);
    expect(lastBeatEnded([{ ...beats[0], startTime: null }], "2026-10-09T23:00")).toBe(false);
  });

  it("keeps every venue and moves the meal into its window when it can", () => {
    const { moment, times } = timesAt("2026-10-09T18:01");
    expect(times.mealFirst).toBe(false);
    const result = retimeBeatsForMoment(beats, moment.kind, times)!;
    expect(result.reordered).toBe(false);
    expect(result.beats.map((beat) => beat.place?.name)).toEqual(["Jardim Azul", "Mare Alta", "Miradouro"]);
    expect(result.beats[0].startTime).toBe(times.startTime);
    expect(result.beats[1].startTime).toBe(times.mealStart);
    expect(result.beats[1].startTime! >= "19:00" && result.beats[1].startTime! <= "21:00").toBe(true);
  });

  it("goes meal-first, same venues, when it is now late (acceptance 4: made 16:00, opened 20:30)", () => {
    const { moment, times } = timesAt("2026-10-09T20:30");
    expect(times.mealFirst).toBe(true);
    const result = retimeBeatsForMoment(beats, moment.kind, times)!;
    expect(result.reordered).toBe(true);
    expect(result.beats[0].place?.name).toBe("Mare Alta");
    expect(result.beats[0].startTime).toBe("21:00");
    expect([...result.beats.map((beat) => beat.place?.name)].sort()).toEqual(["Jardim Azul", "Mare Alta", "Miradouro"]);
    expect(result.beats.every((beat) => beat.directionsUrl === null)).toBe(true);
  });

  it("returns null when the meal window can no longer be met", () => {
    const late = timesAt("2026-10-09T20:59"); // meal first at 21:30, after the 21:00 window
    expect(retimeBeatsForMoment(beats, late.moment.kind, late.times)).toBeNull();
    const noMeal = beats.map((beat) => ({ ...beat, category: "walk", title: "Walk", description: "Walk.", place: { ...beat.place!, kind: "garden", name: beat.place!.name } }));
    const mid = timesAt("2026-10-09T18:01");
    expect(retimeBeatsForMoment(noMeal, mid.moment.kind, mid.times)).toBeNull();
    const weekend = timesAt("2026-10-07T14:00");
    expect(retimeBeatsForMoment(beats, weekend.moment.kind, weekend.times)).toBeNull();
  });

  it("builds a mood under 280 characters for every kind", () => {
    for (const iso of ["2026-10-09T14:00", "2026-10-09T20:00", "2026-10-10T06:30", "2026-10-10T11:00", "2026-10-07T14:00"]) {
      const { moment, times } = timesAt(iso);
      expect(buildMomentMood(moment, times, true).length).toBeLessThanOrEqual(280);
    }
    const { moment, times } = timesAt("2026-10-09T14:00");
    expect(buildMomentMood(moment, times, true)).toContain("Romantic evening for two");
    expect(buildMomentMood(moment, times, false)).not.toMatch(/romantic/i);
  });
});

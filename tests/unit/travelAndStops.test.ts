import { describe, expect, it } from "vitest";
import { radiusForScale } from "../../src/shared/scale.js";
import { stopUnsuitable } from "../../src/server/plans/engine/catalogPlanner.js";
import { computeInputsFingerprint } from "../../src/server/moment/fingerprint.js";

const venue = (name: string, category: string, subcategory: string) => ({ id: name, name, category, subcategory, tags: [], lat: 0, lng: 0 }) as never;
const ctx = (mealStart: string | null) => ({ moment: mealStart ? { mealStart, startTime: mealStart } : null }) as never;

describe("radiusForScale", () => {
  it("uses the user's own distance, else the scale default", () => {
    expect(radiusForScale("day_off", { travelDayKm: 40 })).toBe(40);
    expect(radiusForScale("weekend", { travelWeekendKm: 90 })).toBe(90);
    expect(radiusForScale("day_off", { travelDayKm: null })).toBe(25);
    expect(radiusForScale("weekend", null)).toBe(60);
    expect(radiusForScale("getaway", { travelDayKm: 5 })).toBe(250);
  });
  it("changes the moment fingerprint when the radius changes", () => {
    expect(computeInputsFingerprint([], [], 25)).not.toBe(computeInputsFingerprint([], [], 40));
    expect(computeInputsFingerprint([], [])).toBe(computeInputsFingerprint([], []));
    const lisbon = { lat: 38.72, lng: -9.14 };
    const faro = { lat: 37.02, lng: -7.93 };
    expect(computeInputsFingerprint([], [], 25, lisbon)).not.toBe(computeInputsFingerprint([], [], 25, faro));
    expect(computeInputsFingerprint([], [], 25, lisbon)).toBe(computeInputsFingerprint([], [], 25, { lat: 38.721, lng: -9.141 }));
  });
});

describe("stopUnsuitable", () => {
  it("rejects museums after an evening meal start but not at lunch", () => {
    const museum = venue("Museu do Aljube", "activity", "museum");
    expect(stopUnsuitable(ctx("19:30"), museum)).toBe(true);
    expect(stopUnsuitable(ctx("12:00"), museum)).toBe(false);
  });
  it("rejects fountains and prison forts at any hour, keeps gardens", () => {
    expect(stopUnsuitable(ctx("12:00"), venue("Chafariz da Boa Hora", "outdoor", "garden"))).toBe(true);
    expect(stopUnsuitable(ctx("12:00"), venue("Presídio do Forte da Trafaria", "activity", "attraction"))).toBe(true);
    expect(stopUnsuitable(ctx("19:30"), venue("Jardim Avelar Brotero", "outdoor", "garden"))).toBe(false);
  });
});

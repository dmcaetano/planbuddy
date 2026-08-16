import { describe, expect, it } from "vitest";
import {
  computeTimeWindow,
  describeDuration,
  describeTimeWindow,
  mealHintForWindow,
  DAY_START_MINUTES,
  MIN_USABLE_MINUTES,
} from "../../src/shared/timeWindow.js";

/** Local-time construction, since every window is computed in the user's own timezone. */
function at(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

describe("computeTimeWindow", () => {
  it("starts the rest of today after enough lead time to leave the house", () => {
    // Saturday 2026-08-15, 17:22 → 45 minutes of lead, rounded up to the quarter hour.
    const window = computeTimeWindow("today", at(2026, 8, 15, 17, 22));
    expect(window.startDate).toBe("2026-08-15");
    expect(window.endDate).toBe("2026-08-15");
    expect(window.startTime).toBe("18:15");
    expect(window.endTime).toBe("22:30");
    expect(window.scale).toBe("day_off");
    expect(window.minutesLeft).toBe(255);
    expect(window.usable).toBe(true);
    expect(window.detail).toBe("4h 15m · 18:15–22:30");
  });

  it("never starts a day before its opening hour, however early the request is", () => {
    const window = computeTimeWindow("today", at(2026, 8, 15, 6, 5));
    expect(window.startTime).toBe("09:00");
    expect(window.minutesLeft).toBe(13 * 60 + 30);
  });

  it("refuses to promise a plan once too little of the day is left", () => {
    const scraps = computeTimeWindow("today", at(2026, 8, 15, 20, 30));
    expect(scraps.usable).toBe(false);
    expect(scraps.minutesLeft).toBeLessThan(MIN_USABLE_MINUTES);
    expect(scraps.detail).toBe("Only 1h 15m left");

    const spent = computeTimeWindow("today", at(2026, 8, 15, 21, 40));
    expect(spent.usable).toBe(false);
    expect(spent.minutesLeft).toBe(0);
    expect(spent.detail).toBe("Nothing left to plan");
  });

  it("treats a mid-week weekend as upcoming, from Saturday morning", () => {
    // Tuesday 2026-08-11 → Saturday 2026-08-15 through Sunday 2026-08-16.
    const window = computeTimeWindow("weekend", at(2026, 8, 11, 14, 0));
    expect(window.startDate).toBe("2026-08-15");
    expect(window.endDate).toBe("2026-08-16");
    expect(window.startTime).toBe("09:00");
    expect(window.startsLater).toBe(true);
    expect(window.scale).toBe("weekend");
    // Two full days at 09:00–22:30.
    expect(window.minutesLeft).toBe(2 * (22 * 60 + 30 - DAY_START_MINUTES));
    expect(window.detail).toBe("27h · Sat–Sun");
  });

  it("counts only the hours actually left when the weekend is already underway", () => {
    // Sunday 2026-08-16 at 11:00 — Saturday is spent, so only today remains.
    const window = computeTimeWindow("weekend", at(2026, 8, 16, 11, 0));
    expect(window.startDate).toBe("2026-08-16");
    expect(window.endDate).toBe("2026-08-16");
    expect(window.startsLater).toBe(false);
    expect(window.startTime).toBe("11:45");
    expect(window.scale).toBe("day_off");
    expect(window.label).toBe("Rest of the weekend");
    expect(window.minutesLeft).toBe(22 * 60 + 30 - (11 * 60 + 45));
  });

  it("rolls a spent evening onto the next day of a multi-day window", () => {
    // Saturday 23:10 — today is gone, but Sunday is not.
    const window = computeTimeWindow("weekend", at(2026, 8, 15, 23, 10));
    expect(window.startDate).toBe("2026-08-16");
    expect(window.startTime).toBe("09:00");
    expect(window.usable).toBe(true);
  });

  it("runs the rest of the week through Sunday, and collapses to a day on Sunday itself", () => {
    const midWeek = computeTimeWindow("week", at(2026, 8, 12, 10, 0));
    expect(midWeek.startDate).toBe("2026-08-12");
    expect(midWeek.endDate).toBe("2026-08-16");
    expect(midWeek.scale).toBe("weekend");

    const sunday = computeTimeWindow("week", at(2026, 8, 16, 10, 0));
    expect(sunday.startDate).toBe("2026-08-16");
    expect(sunday.endDate).toBe("2026-08-16");
    expect(sunday.scale).toBe("day_off");
  });

  it("rolls a spent weekend or week forward to the next one", () => {
    // Sunday 2026-08-16 at 21:50 — the weekend and the week are both over.
    const weekend = computeTimeWindow("weekend", at(2026, 8, 16, 21, 50));
    expect(weekend.label).toBe("Next weekend");
    expect(weekend.startDate).toBe("2026-08-22");
    expect(weekend.endDate).toBe("2026-08-23");
    expect(weekend.usable).toBe(true);
    expect(weekend.startsLater).toBe(true);
    expect(weekend.detail).toBe("27h · Sat–Sun");

    const week = computeTimeWindow("week", at(2026, 8, 16, 21, 50));
    expect(week.label).toBe("Next week");
    expect(week.startDate).toBe("2026-08-17");
    expect(week.endDate).toBe("2026-08-23");
    expect(week.usable).toBe(true);

    // A day with nothing left stays honestly unplannable — "tomorrow" is not "today".
    expect(computeTimeWindow("today", at(2026, 8, 16, 21, 50)).usable).toBe(false);
  });

  it("counts Friday evening as part of the weekend", () => {
    const fridayEvening = computeTimeWindow("weekend", at(2026, 8, 14, 18, 0));
    expect(fridayEvening.startDate).toBe("2026-08-14");
    expect(fridayEvening.endDate).toBe("2026-08-15");

    const fridayMorning = computeTimeWindow("weekend", at(2026, 8, 14, 9, 0));
    expect(fridayMorning.startDate).toBe("2026-08-15");
  });
});

describe("mealHintForWindow", () => {
  it("anchors on dinner for an evening window and lunch for a late-morning one", () => {
    expect(mealHintForWindow(computeTimeWindow("today", at(2026, 8, 15, 16, 30)))).toBe("dinner");
    expect(mealHintForWindow(computeTimeWindow("today", at(2026, 8, 15, 10, 30)))).toBe("lunch");
    expect(mealHintForWindow(computeTimeWindow("today", at(2026, 8, 15, 14, 0)))).toBe("flexible");
  });
});

describe("describeDuration and describeTimeWindow", () => {
  it("reads like a plan, not a stopwatch", () => {
    expect(describeDuration(45)).toBe("45m");
    expect(describeDuration(120)).toBe("2h");
    expect(describeDuration(255)).toBe("4h 15m");
  });

  it("states the exact window the plan has to fit inside", () => {
    const sameDay = describeTimeWindow(computeTimeWindow("today", at(2026, 8, 15, 17, 22)));
    expect(sameDay).toBe("Time left: 4h 15m between 18:15 and 22:30 today");

    const multiDay = describeTimeWindow(computeTimeWindow("weekend", at(2026, 8, 11, 14, 0)));
    expect(multiDay).toBe("Time left: 27h from 09:00 on 2026-08-15 to 22:30 on 2026-08-16");
  });
});

import { describe, expect, it } from "vitest";
import {
  PARTNER_WORDS,
  addDays,
  isPartnerWord,
  matchingMomentRows,
  momentTimes,
  parseLocalDateTime,
  resolveMoment,
  scopeSwitchMoments,
  weekdayOf,
} from "../../src/shared/moment.js";

// Week of Monday 2026-10-05. 2026-10-09 is a Friday (the spec's own example key).
const MON = "2026-10-05";
const WED = "2026-10-07";
const THU = "2026-10-08";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const NEXT_SAT = "2026-10-17";

describe("moment table (spec rule 2, acceptance 1)", () => {
  const rows: [string, string, "weekend" | "tonight" | "day", string][] = [
    ["Mon 09:00", `${MON}T09:00`, "weekend", SAT],
    ["Wed 14:00", `${WED}T14:00`, "weekend", SAT],
    ["Thu 23:30", `${THU}T23:30`, "weekend", SAT],
    ["Fri 00:00", `${FRI}T00:00`, "weekend", SAT],
    ["Fri 12:59", `${FRI}T12:59`, "weekend", SAT],
    ["Fri 13:00", `${FRI}T13:00`, "tonight", FRI],
    ["Fri 20:59", `${FRI}T20:59`, "tonight", FRI],
    ["Fri 21:00", `${FRI}T21:00`, "day", SAT],
    ["Sat 02:00", `${SAT}T02:00`, "day", SAT],
    ["Sat 06:00", `${SAT}T06:00`, "day", SAT],
    ["Sat 12:59", `${SAT}T12:59`, "day", SAT],
    ["Sat 13:00", `${SAT}T13:00`, "tonight", SAT],
    ["Sat 20:59", `${SAT}T20:59`, "tonight", SAT],
    ["Sat 21:00", `${SAT}T21:00`, "day", SUN],
    ["Sun 02:00", `${SUN}T02:00`, "day", SUN],
    ["Sun 12:59", `${SUN}T12:59`, "day", SUN],
    ["Sun 13:00", `${SUN}T13:00`, "tonight", SUN],
    ["Sun 20:59", `${SUN}T20:59`, "tonight", SUN],
    ["Sun 21:00", `${SUN}T21:00`, "weekend", NEXT_SAT],
  ];

  it.each(rows)("%s -> kind, plan date and key", (_label, iso, kind, planDate) => {
    const moment = resolveMoment(iso);
    expect(moment.kind).toBe(kind);
    expect(moment.planDate).toBe(planDate);
    expect(moment.key).toBe(`${kind}:${planDate}`);
  });

  it("labels the moment for the reason line", () => {
    expect(resolveMoment(`${FRI}T19:00`).label).toBe("Friday evening");
    expect(resolveMoment(`${SAT}T11:00`).label).toBe("Saturday");
    expect(resolveMoment(`${SUN}T09:00`).label).toBe("Sunday");
    expect(resolveMoment(`${WED}T14:00`).label).toBe("This weekend");
  });

  it("maps every minute of a sample week to exactly one row", () => {
    let minutes = 0;
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(MON, day);
      for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay += 1) {
        const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
        const mm = String(minuteOfDay % 60).padStart(2, "0");
        const iso = `${date}T${hh}:${mm}`;
        const matches = matchingMomentRows(iso);
        if (matches.length !== 1) throw new Error(`${iso} matched ${matches.length} rows`);
        minutes += 1;
      }
    }
    expect(minutes).toBe(7 * 1440);
  });

  it("derives the weekday from the date text, never from the server time zone", () => {
    expect(weekdayOf(FRI)).toBe(5);
    expect(weekdayOf(SUN)).toBe(7);
    expect(weekdayOf(MON)).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("strict local date-time parsing", () => {
  it("accepts YYYY-MM-DDTHH:mm and YYYY-MM-DDTHH:mm:ss", () => {
    expect(parseLocalDateTime("2026-10-09T19:00")?.minutesOfDay).toBe(19 * 60);
    expect(parseLocalDateTime("2026-10-09T19:00:30")?.second).toBe(30);
  });

  it.each([
    "",
    "garbage",
    "2026-10-09",
    "2026-10-09T19",
    "2026-10-09 19:00",
    "2026-10-09T24:00",
    "2026-10-09T19:60",
    "2026-10-09T19:00:60",
    "2026-02-30T10:00",
    "2026-13-01T10:00",
    "2026-10-09T19:00Z",
    "2026-10-09T19:00:00+01:00",
    "2026-10-09T19:00:00.000Z",
    "2019-12-31T10:00",
    "2101-01-01T10:00",
    "26-10-09T19:00",
  ])("rejects %j", (value) => {
    expect(parseLocalDateTime(value)).toBeNull();
    expect(() => resolveMoment(value)).toThrow();
  });

  it("rejects non-strings", () => {
    expect(parseLocalDateTime(null)).toBeNull();
    expect(parseLocalDateTime(12345)).toBeNull();
    expect(parseLocalDateTime({})).toBeNull();
  });
});

describe("moment timing (spec rule 4, acceptance 2)", () => {
  const times = (iso: string) => {
    const moment = resolveMoment(iso);
    return momentTimes(moment.kind, moment.planDate, iso);
  };

  it("Fri 14:00: first beat 16:30, meal second, starting 19:00-21:00", () => {
    const t = times(`${FRI}T14:00`);
    expect(t.startTime).toBe("16:30");
    expect(t.mealFirst).toBe(false);
    expect(t.mealWindow).toEqual({ from: "19:00", to: "21:00" });
    expect(t.mealStart! >= "19:00" && t.mealStart! <= "21:00").toBe(true);
  });

  it("Fri 19:00: first beat 19:30 and it is the meal", () => {
    const t = times(`${FRI}T19:00`);
    expect(t.startTime).toBe("19:30");
    expect(t.mealFirst).toBe(true);
    expect(t.mealStart).toBe("19:30");
  });

  it("Fri 20:59: meal first, starting 21:30, never after 22:00", () => {
    const t = times(`${FRI}T20:59`);
    expect(t.startTime).toBe("21:30");
    expect(t.mealFirst).toBe(true);
    expect(t.mealStart).toBe("21:30");
    expect(t.lateMealFirst).toBe(true);
    // Every tonight minute keeps the meal start at or before 22:00.
    for (let minute = 13 * 60; minute < 21 * 60; minute += 1) {
      const iso = `${FRI}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      expect(times(iso).mealStart! <= "22:00").toBe(true);
    }
  });

  it("the Tonight chip at Fri 22:00 gives a plan dated Saturday whose first beat is 16:30", () => {
    const iso = `${FRI}T22:00`;
    const tonight = scopeSwitchMoments(iso).tonight;
    expect(tonight.planDate).toBe(SAT);
    expect(tonight.key).toBe(`tonight:${SAT}`);
    expect(momentTimes("tonight", tonight.planDate, iso).startTime).toBe("16:30");
  });

  it("Sat 06:30: first beat 10:00, lunch second", () => {
    const t = times(`${SAT}T06:30`);
    expect(t.startTime).toBe("10:00");
    expect(t.mealFirst).toBe(false);
    expect(t.mealWindow).toEqual({ from: "12:00", to: "15:00" });
    expect(t.mealStart! >= "12:00" && t.mealStart! <= "15:00").toBe(true);
  });

  it("Sat 11:00: first beat 12:00 and it is the lunch", () => {
    const t = times(`${SAT}T11:00`);
    expect(t.startTime).toBe("12:00");
    expect(t.mealFirst).toBe(true);
    expect(t.mealStart).toBe("12:00");
  });

  it("rounds the tonight start up to the next quarter hour and the day start to a full hour", () => {
    expect(times(`${FRI}T15:10`).startTime).toBe("16:30"); // floor wins
    expect(times(`${FRI}T18:01`).startTime).toBe("18:45"); // 18:31 -> 18:45
    expect(times(`${FRI}T18:00`).startTime).toBe("18:30");
    expect(times(`${SAT}T11:01`).startTime).toBe("13:00"); // 12:01 -> 13:00
    expect(times(`${SAT}T09:30`).startTime).toBe("11:00"); // 10:30 -> 11:00
  });

  it("a plan dated after today uses the fixed starts", () => {
    expect(momentTimes("tonight", SAT, `${FRI}T20:30`).startTime).toBe("16:30");
    expect(momentTimes("day", SUN, `${SAT}T12:00`).startTime).toBe("10:00");
  });

  it("weekend has no moment timing", () => {
    const t = times(`${WED}T14:00`);
    expect(t.startTime).toBeNull();
    expect(t.mealStart).toBeNull();
  });
});

describe("scope switch dates (spec rule 13)", () => {
  it("Fri 22:00: tonight and a day out are tomorrow, the weekend is the coming Saturday", () => {
    const s = scopeSwitchMoments(`${FRI}T22:00`);
    expect(s.tonight.planDate).toBe(SAT);
    expect(s.day.planDate).toBe(SAT);
    expect(s.weekend.planDate).toBe(SAT);
  });

  it("Wed 14:00: tonight is today, a day out is tomorrow", () => {
    const s = scopeSwitchMoments(`${WED}T14:00`);
    expect(s.tonight.planDate).toBe(WED);
    expect(s.day.planDate).toBe(THU);
    expect(s.weekend.planDate).toBe(SAT);
  });

  it("before 13:00 a day out is today, before 21:00 tonight is today", () => {
    expect(scopeSwitchMoments(`${SAT}T09:00`).day.planDate).toBe(SAT);
    expect(scopeSwitchMoments(`${SAT}T12:59`).day.planDate).toBe(SAT);
    expect(scopeSwitchMoments(`${SAT}T13:00`).day.planDate).toBe(SUN);
    expect(scopeSwitchMoments(`${SAT}T20:59`).tonight.planDate).toBe(SAT);
    expect(scopeSwitchMoments(`${SAT}T21:00`).tonight.planDate).toBe(SUN);
  });

  it("Sunday points the weekend at the next Saturday", () => {
    expect(scopeSwitchMoments(`${SUN}T10:00`).weekend.planDate).toBe(NEXT_SAT);
  });
});

describe("partner words (spec rule 12)", () => {
  it("lists exactly the words from the spec", () => {
    expect(PARTNER_WORDS).toEqual([
      "wife", "husband", "partner", "spouse", "girlfriend", "boyfriend", "fiancé", "fiancée",
      "esposa", "marido", "mulher", "namorada", "namorado", "noiva", "noivo", "companheira", "companheiro",
    ]);
  });

  it("matches case-insensitively, with or without accents, and never guesses", () => {
    expect(isPartnerWord("Wife")).toBe(true);
    expect(isPartnerWord(" ESPOSA ")).toBe(true);
    expect(isPartnerWord("fiance")).toBe(true);
    expect(isPartnerWord("fiancée")).toBe(true);
    expect(isPartnerWord("friend")).toBe(false);
    expect(isPartnerWord("PlanBuddy friend")).toBe(false);
    expect(isPartnerWord("dog")).toBe(false);
    expect(isPartnerWord(null)).toBe(false);
    expect(isPartnerWord("")).toBe(false);
  });
});

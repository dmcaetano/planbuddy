import { describe, expect, it } from "vitest";
import { parseTimeOffIntent } from "../../src/server/chat/timeOffIntent.js";

const TODAY = "2026-10-07";

describe("parseTimeOffIntent", () => {
  it("parses a short range with a bare end day", () => {
    expect(parseTimeOffIntent("I'm off Dec 24 to 31", TODAY)).toEqual({ label: "Time off", startDate: "2026-12-24", endDate: "2026-12-31" });
    expect(parseTimeOffIntent("I’m off Dec 24 to 31.", TODAY)?.endDate).toBe("2026-12-31");
  });

  it("parses day-first dates and keeps the user's word as the label", () => {
    expect(parseTimeOffIntent("I have vacation from 24 December to 2 January", TODAY)).toEqual({
      label: "Vacation",
      startDate: "2026-12-24",
      endDate: "2027-01-02",
    });
    expect(parseTimeOffIntent("We have holidays 24th of December until 2nd of January", TODAY)).toMatchObject({
      label: "Holiday",
      startDate: "2026-12-24",
      endDate: "2027-01-02",
    });
  });

  it("parses ISO dates", () => {
    expect(parseTimeOffIntent("time off 2026-12-24 to 2026-12-31", TODAY)).toEqual({ label: "Time off", startDate: "2026-12-24", endDate: "2026-12-31" });
    expect(parseTimeOffIntent("I'm on leave from 2027-02-01 - 2027-02-05", TODAY)).toMatchObject({ label: "Leave", startDate: "2027-02-01", endDate: "2027-02-05" });
  });

  it("assumes the next occurrence of a date with no year", () => {
    expect(parseTimeOffIntent("I'm off Mar 3 to 7", TODAY)).toMatchObject({ startDate: "2027-03-03", endDate: "2027-03-07" });
    expect(parseTimeOffIntent("I'm off Oct 7 to 9", TODAY)).toMatchObject({ startDate: "2026-10-07", endDate: "2026-10-09" });
    expect(parseTimeOffIntent("I'm off Oct 6 to 9", TODAY)).toMatchObject({ startDate: "2027-10-06", endDate: "2027-10-09" });
  });

  it("rolls a bare end day into the next month and an explicit month into the next year", () => {
    expect(parseTimeOffIntent("I'm off Dec 28 to 3", TODAY)).toMatchObject({ startDate: "2026-12-28", endDate: "2027-01-03" });
    expect(parseTimeOffIntent("I'm off Dec 28 to Jan 3", TODAY)).toMatchObject({ endDate: "2027-01-03" });
  });

  it("accepts separators and a leading Buddy address", () => {
    expect(parseTimeOffIntent("Buddy, I'm off Dec 24 - Dec 31", TODAY)).toMatchObject({ startDate: "2026-12-24", endDate: "2026-12-31" });
    expect(parseTimeOffIntent("I am on vacation between Dec 24 and Dec 31", TODAY)).toMatchObject({ label: "Vacation", endDate: "2026-12-31" });
  });

  it("ignores everything that is not a plain time-off statement", () => {
    for (const text of [
      "",
      "What are my holidays?",
      "I'm off Dec 24",
      "I love holidays by the sea",
      "Dani is my wife",
      "I'm off Feb 30 to 31",
      "Plan a trip for Dec 24 to 31",
      "we are allergic to peanuts",
      "I'm off Dec 31 to Dec 24 2025",
    ]) {
      expect(parseTimeOffIntent(text, TODAY), text).toBeNull();
    }
  });
});

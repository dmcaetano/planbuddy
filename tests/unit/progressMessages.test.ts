import { describe, expect, it } from "vitest";
import { formatVenueDetail } from "../../src/server/ai/index.js";

describe("formatVenueDetail", () => {
  it("falls back to a generic message when there are no named places yet", () => {
    expect(formatVenueDetail([])).toBe("Composing your plan");
  });

  it("ignores blank/whitespace-only names", () => {
    expect(formatVenueDetail(["  ", ""])).toBe("Composing your plan");
  });

  it("names a single venue without a trailing count", () => {
    expect(formatVenueDetail(["Saldanha Mar"])).toBe("Composing around Saldanha Mar");
  });

  it("names exactly two venues without a trailing count", () => {
    expect(formatVenueDetail(["Saldanha Mar", "Jardim da Estrela"])).toBe(
      "Composing around Saldanha Mar, Jardim da Estrela"
    );
  });

  it("caps at 2 names and appends a count of the rest", () => {
    expect(
      formatVenueDetail(["Saldanha Mar", "Jardim da Estrela", "Time Out Market", "LX Factory", "Miradouro da Graça"])
    ).toBe("Composing around Saldanha Mar, Jardim da Estrela + 3 more");
  });

  it("truncates names longer than 30 characters", () => {
    const longName = "The Absolutely Enormous Seafront Restaurant";
    const result = formatVenueDetail([longName]);
    expect(result).toBe("Composing around The Absolutely Enormous Seafr…");
    // "The Absolutely Enormous Sea…" (the truncated name) must be <= 30 chars.
    const shownName = result.replace("Composing around ", "");
    expect(shownName.length).toBeLessThanOrEqual(30);
  });

  it("leaves names of exactly 30 characters untouched", () => {
    const exact30 = "A".repeat(30);
    expect(formatVenueDetail([exact30])).toBe(`Composing around ${exact30}`);
  });
});

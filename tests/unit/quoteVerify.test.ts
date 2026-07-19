import { describe, expect, it } from "vitest";
import { verifyQuote } from "../../src/server/memory/quoteVerify.js";

describe("verifyQuote (quote-or-demote)", () => {
  const message = "We are allergic to peanuts and love hiking on weekends";

  it("verifies a correct verbatim quote at correct offsets", () => {
    const quote = "allergic to peanuts";
    const start = message.indexOf(quote);
    expect(verifyQuote(message, quote, start, start + quote.length)).toBe(true);
  });

  it("rejects when the quote text does not match the offsets", () => {
    expect(verifyQuote(message, "allergic to peanuts", 0, 5)).toBe(false);
  });

  it("rejects a quote that is not actually in the message", () => {
    const quote = "allergic to shellfish";
    expect(verifyQuote(message, quote, 0, quote.length)).toBe(false);
  });

  it("rejects when quote, quoteStart, or quoteEnd is missing", () => {
    expect(verifyQuote(message, null, 0, 5)).toBe(false);
    expect(verifyQuote(message, "allergic", null, 5)).toBe(false);
    expect(verifyQuote(message, "allergic", 0, null)).toBe(false);
  });

  it("rejects out-of-bounds or inverted offsets", () => {
    expect(verifyQuote(message, "x", -1, 1)).toBe(false);
    expect(verifyQuote(message, "x", 5, 5)).toBe(false);
    expect(verifyQuote(message, "x", 0, message.length + 10)).toBe(false);
  });
});

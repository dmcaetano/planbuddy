import { describe, expect, it } from "vitest";
import { stringifyJsonForDb } from "../../src/server/db/json.js";

describe("Postgres-safe JSON serialization", () => {
  it("removes NUL characters from nested model copy", () => {
    const json = stringifyJsonForDb({
      title: "Good\u0000 plan",
      beats: [{ description: "Fish\u0000 and a walk" }],
    });
    expect(json).toBe('{"title":"Good plan","beats":[{"description":"Fish and a walk"}]}');
    expect(json).not.toContain("\\u0000");
  });

  it("preserves ordinary Unicode and numbers", () => {
    expect(stringifyJsonForDb({ place: "Jardim Amália", cost: "€35–50", minutes: 60 })).toBe(
      '{"place":"Jardim Amália","cost":"€35–50","minutes":60}'
    );
  });
});

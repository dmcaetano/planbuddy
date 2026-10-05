import { describe, expect, it } from "vitest";
import { nameKey, parseRelationshipIntent } from "../../src/server/chat/relationshipIntent.js";

describe("parseRelationshipIntent", () => {
  it.each([
    ["Dani is my wife", "Dani", "wife"],
    ["dani is my wife.", "dani", "wife"],
    ["Sissi is my daughter", "Sissi", "daughter"],
    ["my wife is Dani", "Dani", "wife"],
    ["My husband is João!", "João", "husband"],
    ["Hey buddy, Zoë is my best friend", "Zoë", "best friend"],
    ["Inês is my esposa", "Inês", "esposa"],
    ["Rui é my marido", "Rui", "marido"],
    ["Ana Maria is my mother", "Ana Maria", "mother"],
    ["Rex is my dog", "Rex", "dog"],
  ])("parses %s", (text, name, relationship) => {
    expect(parseRelationshipIntent(text)).toMatchObject({ name, relationship, known: true });
  });

  it("keeps Portuguese words as typed (lower-cased, not translated)", () => {
    expect(parseRelationshipIntent("Maria is my Esposa")?.relationship).toBe("esposa");
  });

  it("flags non-vocabulary single words as unknown so the route can gate them", () => {
    expect(parseRelationshipIntent("Dani is my landlord")).toMatchObject({ name: "Dani", relationship: "landlord", known: false });
  });

  it.each([
    "Dani is my favourite restaurant",
    "Pizza is my favourite",
    "She is my wife",
    "Is Dani my wife?",
    "my wife is sick",
    "Dani is my wife and she loves hiking",
    "Dani is not my wife",
    "We love hiking",
    "Dani is my",
    "",
    "Dinner is my passion",
  ])("ignores %s", (text) => {
    expect(parseRelationshipIntent(text)).toBeNull();
  });
});

describe("nameKey", () => {
  it("ignores accents, case and spacing", () => {
    expect(nameKey("  JOÃO  Inês ")).toBe(nameKey("joao ines"));
  });
});

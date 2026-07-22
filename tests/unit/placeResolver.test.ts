import { describe, expect, it } from "vitest";
import { overpassQuery, parseOverpassElements } from "../../src/server/resolver/placeResolver.js";

describe("place resolver catalogue", () => {
  it("caps external discovery at 60 km", () => {
    const query = overpassQuery(38.7223, -9.1393, 500);
    expect(query).toContain("around:60000");
    expect(query).toContain('"amenity"~"restaurant|cafe|biergarten|food_court"');
  });

  it("parses nodes and centered ways into typed, source-backed venues", () => {
    const venues = parseOverpassElements([
      {
        type: "node",
        id: 1,
        lat: 38.72,
        lon: -9.14,
        tags: { name: "Peixe Bom", amenity: "restaurant", cuisine: "seafood;portuguese", dog: "yes" },
      },
      {
        type: "way",
        id: 2,
        center: { lat: 38.73, lon: -9.15 },
        tags: { name: "Jardim Real", leisure: "garden", "addr:city": "Lisboa" },
      },
    ]);
    expect(venues).toHaveLength(2);
    expect(venues[0]).toMatchObject({ category: "food", subcategory: "restaurant" });
    expect(venues[0].tags).toEqual(expect.arrayContaining(["seafood", "portuguese", "dog friendly"]));
    expect(venues[0].sourceUrl).toBe("https://www.openstreetmap.org/node/1");
    expect(venues[1]).toMatchObject({ category: "outdoor", subcategory: "garden", address: "Lisboa" });
  });

  it("deduplicates the same nearby named feature and drops unsupported records", () => {
    const venues = parseOverpassElements([
      { type: "node", id: 1, lat: 38.72, lon: -9.14, tags: { name: "Jardim da Luz", leisure: "park" } },
      { type: "way", id: 2, center: { lat: 38.7201, lon: -9.1401 }, tags: { name: "Jardim da Luz", leisure: "park" } },
      { type: "node", id: 3, lat: 38.72, lon: -9.14, tags: { name: "Unrelated Shop", shop: "clothes" } },
      { type: "node", id: 4, tags: { name: "Missing Coordinates", tourism: "museum" } },
    ]);
    expect(venues.map((venue) => venue.name)).toEqual(["Jardim da Luz"]);
  });
});

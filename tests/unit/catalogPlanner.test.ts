import { describe, expect, it } from "vitest";
import { buildCatalogCandidate, distanceKm } from "../../src/server/plans/engine/catalogPlanner.js";
import type { GenerateContext } from "../../src/server/ai/demoAi.js";
import type { ResolvedVenue } from "../../src/server/resolver/placeResolver.js";

function venue(
  id: string,
  name: string,
  category: ResolvedVenue["category"],
  lat: number,
  lng: number,
  subcategory = category === "food" ? "restaurant" : "park",
  tags: string[] = []
): ResolvedVenue {
  return {
    id,
    name,
    category,
    subcategory,
    lat,
    lng,
    openNow: null,
    sourceUrl: `https://www.openstreetmap.org/${id}`,
    address: `${name} address`,
    tags: [subcategory, ...tags],
  };
}

const catalog: ResolvedVenue[] = [
  venue("node/1", "Maré Alta", "food", 38.722, -9.139, "restaurant", ["seafood", "portuguese"]),
  venue("node/2", "Jardim Azul", "outdoor", 38.724, -9.142, "garden"),
  venue("node/3", "Miradouro Claro", "outdoor", 38.719, -9.135, "viewpoint"),
  venue("node/4", "Grelha do Bairro", "food", 38.747, -9.154, "restaurant", ["grill", "meat"]),
  venue("node/5", "Parque Verde", "outdoor", 38.749, -9.157, "park"),
  venue("node/6", "Galeria Norte", "activity", 38.744, -9.151, "gallery"),
  venue("node/7", "Peixe do Tejo", "food", 38.770, -9.180, "restaurant", ["fish", "seafood"]),
  venue("node/8", "Jardim do Tejo", "outdoor", 38.772, -9.182, "garden"),
  venue("node/9", "Vista do Tejo", "outdoor", 38.768, -9.177, "viewpoint"),
  venue("node/10", "Mesa Alternativa", "food", 38.721, -9.137, "restaurant", ["portuguese"]),
];

function context(overrides: Partial<GenerateContext> = {}): GenerateContext {
  return {
    scale: "weekend",
    homeBaseLabel: "Lisbon",
    homeBaseLat: 38.7223,
    homeBaseLng: -9.1393,
    participants: [{ name: "Pom", kind: "pet", relationship: "dog" }],
    moodContext: "A walk and a healthy grilled fish meal",
    radiusKm: 60,
    activeConstraints: [],
    loveTastes: [],
    recentSuggestions: [],
    seed: "plan:1",
    ...overrides,
  };
}

describe("catalog planner", () => {
  it("builds a compact, Maps-ready three-stop plan from resolver venues", () => {
    const candidate = buildCatalogCandidate(context(), catalog);
    expect(candidate).not.toBeNull();
    expect(candidate?.beats).toHaveLength(3);
    expect(candidate?.resolverVenueIds.length).toBeGreaterThanOrEqual(3);
    expect(new Set(candidate?.beats.map((beat) => beat.place?.name)).size).toBe(3);
    expect(candidate?.beats.every((beat) => beat.place?.sourceUrl.startsWith("https://www.openstreetmap.org/"))).toBe(true);
    expect(candidate?.beats[1].place?.kind).toBe("restaurant");
    expect(candidate?.checkBeforeYouGo.join(" ")).toContain("Pom");
    expect(candidate?.rationale).toContain("mapped places");
  });

  it("does not reuse any place from recent surfaced suggestions", () => {
    const first = buildCatalogCandidate(context(), catalog)!;
    const recentNames = first.beats.map((beat) => beat.place!.name);
    const second = buildCatalogCandidate(
      context({
        seed: "plan:2",
        recentSuggestions: [{ title: first.title, category: first.category, placeNames: recentNames }],
      }),
      catalog
    );
    expect(second).not.toBeNull();
    expect(second?.beats.every((beat) => !recentNames.includes(beat.place!.name))).toBe(true);
  });

  it("returns no fabricated route when the catalogue lacks a compact cluster", () => {
    const sparse = [
      venue("node/20", "Remote Table", "food", 38.72, -9.14),
      venue("node/21", "Far Park", "outdoor", 38.80, -9.30),
      venue("node/22", "Other Far Park", "outdoor", 38.60, -9.00),
    ];
    expect(buildCatalogCandidate(context(), sparse)).toBeNull();
  });

  it("calculates real geographic distance rather than inventing a route length", () => {
    const km = distanceKm({ lat: 38.7223, lng: -9.1393 }, { lat: 38.7078, lng: -9.1366 });
    expect(km).toBeGreaterThan(1.5);
    expect(km).toBeLessThan(1.8);
  });
});

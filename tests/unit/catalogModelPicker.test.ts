import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCandidateFromPicks,
  buildCatalogCandidateWithMatch,
  buildCatalogShortlist,
} from "../../src/server/plans/engine/catalogPlanner.js";
import { pickRouteWithModel, selectCatalogMatch } from "../../src/server/plans/engine/catalogModelPicker.js";
import type { GenerateContext } from "../../src/server/ai/demoAi.js";
import type { ResolvedVenue } from "../../src/server/resolver/placeResolver.js";
import { env } from "../../src/server/env.js";

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
    id, name, category, subcategory, lat, lng, openNow: null,
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
  venue("node/10", "Mesa Alternativa", "food", 38.721, -9.137, "restaurant", ["portuguese"]),
  venue("node/11", "Café", "outdoor", 38.7225, -9.1395, "park"), // generic name
  venue("node/12", "Jardim Longe", "outdoor", 38.80, -9.20, "garden"), // far from every restaurant
  venue("node/13", "Praça Dupla", "outdoor", 38.7241, -9.1421, "garden"), // within 0.15 km of Jardim Azul
];

function ctx(overrides: Partial<GenerateContext> = {}): GenerateContext {
  return {
    scale: "weekend",
    homeBaseLabel: "Lisbon",
    homeBaseLat: 38.7223,
    homeBaseLng: -9.1393,
    participants: [],
    moodContext: "A romantic dinner",
    radiusKm: 60,
    activeConstraints: [],
    loveTastes: [{ id: "t1", text: "grilled fish", source: "taste" }],
    recentSuggestions: [],
    seed: "spec:0",
    moment: { kind: "tonight", startTime: "17:30", mealFirst: false, mealStart: "19:00", romantic: true },
    ...overrides,
  };
}

const goodPicks = { mealId: "node/1", firstStopId: "node/2", secondStopId: "node/3" };

describe("buildCatalogShortlist", () => {
  it("lists real restaurants with their own nearby non-food stops, no generic names", () => {
    const list = buildCatalogShortlist(ctx(), catalog);
    expect(list.meals.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(catalog.map((v) => v.id));
    for (const meal of list.meals) {
      expect(ids.has(meal.id)).toBe(true);
      expect(meal.stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of meal.stops) {
        expect(catalog.find((v) => v.id === stop.id)?.category).not.toBe("food");
        expect(stop.distanceKm).toBeLessThanOrEqual(1.7);
        expect(stop.name).not.toBe("Café");
      }
    }
    expect(list.meals.map((m) => m.id)).toContain("node/1");
  });

  it("excludes recently suggested places", () => {
    const list = buildCatalogShortlist(ctx({ recentSuggestions: [{ title: "x", category: "food", placeNames: ["Maré Alta", "Jardim Azul"] }] }), catalog);
    expect(list.meals.map((m) => m.id)).not.toContain("node/1");
    expect(list.meals.flatMap((m) => m.stops.map((s) => s.id))).not.toContain("node/2");
  });

  it("is empty without a home base", () => {
    expect(buildCatalogShortlist(ctx({ homeBaseLat: null, homeBaseLng: null }), catalog).meals).toEqual([]);
  });
});

describe("buildCandidateFromPicks", () => {
  it("assembles a candidate from valid picks with the moment timing and the model's wording", () => {
    const match = buildCandidateFromPicks(ctx(), catalog, goodPicks, { title: "Fish and gardens", rationale: "Grilled fish near quiet gardens." });
    expect(match).not.toBeNull();
    const c = match!.candidate;
    expect(c.title).toBe("Fish and gardens");
    expect(c.rationale).toBe("Grilled fish near quiet gardens.");
    expect(c.beats.map((b) => b.place?.name)).toEqual(["Jardim Azul", "Maré Alta", "Miradouro Claro"]);
    expect(c.beats[0].startTime).toBe("17:30");
    expect(c.resolverVenueIds).toEqual(expect.arrayContaining(["node/1", "node/2", "node/3"]));
    expect(match!.matchedTasteId).toBe("t1");
  });

  it("honours meal-first moments", () => {
    const match = buildCandidateFromPicks(
      ctx({ moment: { kind: "tonight", startTime: "19:30", mealFirst: true, mealStart: "19:30", romantic: false } }),
      catalog,
      goodPicks
    );
    expect(match!.candidate.beats[0].category).toBe("food");
  });

  it("rejects an unknown id", () => {
    expect(buildCandidateFromPicks(ctx(), catalog, { ...goodPicks, mealId: "node/999" })).toBeNull();
  });

  it("rejects a stop too far to walk from the restaurant", () => {
    expect(buildCandidateFromPicks(ctx(), catalog, { ...goodPicks, secondStopId: "node/12" })).toBeNull();
  });

  it("rejects duplicate, wrong-kind and too-close stops", () => {
    expect(buildCandidateFromPicks(ctx(), catalog, { ...goodPicks, secondStopId: "node/2" })).toBeNull();
    expect(buildCandidateFromPicks(ctx(), catalog, { ...goodPicks, secondStopId: "node/10" })).toBeNull();
    expect(buildCandidateFromPicks(ctx(), catalog, { ...goodPicks, secondStopId: "node/13" })).toBeNull();
    expect(buildCandidateFromPicks(ctx(), catalog, { ...goodPicks, mealId: "node/2" })).toBeNull();
  });

  it("rejects a recent stop", () => {
    const recent = [{ title: "x", category: "food", placeNames: ["Miradouro Claro"] }];
    expect(buildCandidateFromPicks(ctx({ recentSuggestions: recent }), catalog, goodPicks)).toBeNull();
  });

  it("rejects a venue that violates a constraint", () => {
    const withTags = catalog.map((v) => (v.id === "node/1" ? { ...v, tags: [...v.tags, "shellfish"] } : v));
    expect(buildCandidateFromPicks(ctx({ activeConstraints: [{ id: "c1", text: "shellfish allergy" }] }), withTags, goodPicks)).toBeNull();
    expect(buildCandidateFromPicks(ctx(), withTags, goodPicks)).not.toBeNull();
  });
});

function reply(payload: unknown): Response {
  const body = { choices: [{ finish_reason: "stop", message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }] };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("pickRouteWithModel", () => {
  const originalKey = env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  beforeEach(() => {
    env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    env.OPENROUTER_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const shortlist = () => buildCatalogShortlist(ctx(), catalog);
  const valid = { ...goodPicks, title: "Fish and gardens", why: "Grilled fish beside a quiet garden." };

  it("returns a valid pick and sends only listed venues in a compact prompt", async () => {
    const fetchMock = vi.fn(async () => reply(valid));
    global.fetch = fetchMock as unknown as typeof fetch;
    const pick = await pickRouteWithModel(ctx(), shortlist());
    expect(pick).toEqual(valid);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.messages[1].content).toContain("node/1");
    expect(sent.messages[1].content).toContain("grilled fish");
    expect(sent.messages[1].content.length).toBeLessThan(9000);
  });

  it("returns null on invalid JSON", async () => {
    global.fetch = vi.fn(async () => reply("not json at all")) as unknown as typeof fetch;
    expect(await pickRouteWithModel(ctx(), shortlist())).toBeNull();
  });

  it("returns null on a hallucinated id", async () => {
    global.fetch = vi.fn(async () => reply({ ...valid, mealId: "node/424242" })) as unknown as typeof fetch;
    expect(await pickRouteWithModel(ctx(), shortlist())).toBeNull();
  });

  it("returns null when a stop belongs to another restaurant's list", async () => {
    global.fetch = vi.fn(async () => reply({ ...valid, secondStopId: "node/5" })) as unknown as typeof fetch;
    expect(await pickRouteWithModel(ctx(), shortlist())).toBeNull();
  });

  it("returns null when the call itself fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await pickRouteWithModel(ctx(), shortlist())).toBeNull();
  });
});

describe("selectCatalogMatch (pipeline selection)", () => {
  const pick = { ...goodPicks, title: "Fish and gardens", why: "Grilled fish beside a quiet garden." };

  it("uses the model's venues, wording and a progress sentence when the model path works", async () => {
    const report = vi.fn();
    const match = await selectCatalogMatch(ctx(), catalog, report, { modelAvailable: () => true, pick: async () => pick });
    expect(match!.candidate.beats.map((b) => b.place?.name)).toEqual(["Jardim Azul", "Maré Alta", "Miradouro Claro"]);
    expect(match!.candidate.rationale).toBe(pick.why);
    expect(report).toHaveBeenCalledWith("composing_plan", "Choosing the best dinner spot near you");
  });

  it("falls back to the deterministic plan when the model path returns null or throws", async () => {
    const expected = buildCatalogCandidateWithMatch(ctx(), catalog);
    expect(expected).not.toBeNull();
    const viaNull = await selectCatalogMatch(ctx(), catalog, undefined, { modelAvailable: () => true, pick: async () => null });
    const viaThrow = await selectCatalogMatch(ctx(), catalog, undefined, {
      modelAvailable: () => true,
      pick: async () => {
        throw new Error("boom");
      },
    });
    const viaInvalid = await selectCatalogMatch(ctx(), catalog, undefined, { modelAvailable: () => true, pick: async () => ({ ...pick, secondStopId: "node/12" }) });
    for (const result of [viaNull, viaThrow, viaInvalid]) expect(result).toEqual(expected);
  });

  it("never calls the model in demo mode", async () => {
    const spy = vi.fn(async () => pick);
    const match = await selectCatalogMatch(ctx(), catalog, undefined, { modelAvailable: () => false, pick: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(match).toEqual(buildCatalogCandidateWithMatch(ctx(), catalog));
  });
});

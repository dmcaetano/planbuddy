// Verified candidates for one hub entity. Source of truth: PlanBuddy's bundled OpenStreetMap place catalogue
// (real venues with an OSM URL). It holds places, not events: an artist therefore yields NO candidate rather than
// an invented concert. Unknown entity, no home base, or nothing near the user -> an empty list.
import { distanceKm } from "../plans/engine/catalogPlanner.js";
import { readLisbonBootstrap, type ResolvedVenue } from "../resolver/placeResolver.js";
import { getUserById } from "../users/repo.js";
import { radiusForScale } from "../../shared/scale.js";
import type { Loc } from "./card.js";

export interface Candidate {
  title: string;
  body?: string;
  kind?: string;
  when?: string;
  where?: string;
  url?: string;
  verified_source: string;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

interface Rule {
  words: RegExp;
  subcategories?: string[];
  nameRe?: RegExp;
  tags?: string[];
  label: [string, string];
}

// topic / activity -> the kind of real place that fits
const RULES: Rule[] = [
  { words: /\b(space|astronom\w*|cosmos|stars?|planet\w*|universe|telescope)\b/, subcategories: ["museum", "attraction"], nameRe: /planet|observat|astron|ciencia|science|conhecimento|cosmos/, label: ["a place about space and science", "um local sobre o espaço e a ciência"] },
  { words: /\b(history|historic\w*|heritage|castle|palace|monument\w*)\b/, subcategories: ["museum", "attraction"], label: ["a history museum or landmark", "um museu ou monumento de história"] },
  { words: /\b(art|arts|painting|sculpture|exhibition|gallery|galleries|museum\w*)\b/, subcategories: ["gallery", "museum"], label: ["an art venue", "um espaço de arte"] },
  { words: /\b(nature|hiking|walking|trail\w*|mountain\w*|wildlife|birdwatching|outdoors?)\b/, subcategories: ["nature_reserve", "peak", "wood"], label: ["a nature spot", "um espaço natural"] },
  { words: /\b(beach\w*|sea|ocean|surf\w*|swim\w*|sun)\b/, subcategories: ["beach"], label: ["a beach", "uma praia"] },
  { words: /\b(garden\w*|flowers?|botanic\w*)\b/, subcategories: ["garden"], label: ["a garden", "um jardim"] },
  { words: /\b(views?|scenery|sunset|photography|viewpoint\w*)\b/, subcategories: ["viewpoint"], label: ["a viewpoint", "um miradouro"] },
  { words: /\b(animals?|zoo|dogs?|kids?|children)\b/, subcategories: ["zoo", "theme_park"], label: ["a place for animals or kids", "um espaço com animais ou para crianças"] },
  { words: /\b(park\w*|picnic)\b/, subcategories: ["park", "garden"], label: ["a park", "um parque"] },
];

const CUISINE_TAGS: Record<string, string[]> = {
  italian: ["italian", "pizza", "pasta", "italian_pizza"],
  pizza: ["pizza", "italian_pizza"],
  japanese: ["japanese", "sushi", "ramen"],
  sushi: ["sushi", "japanese"],
  ramen: ["ramen"],
  indian: ["indian", "nepalese"],
  chinese: ["chinese", "asian"],
  mexican: ["mexican"],
  portuguese: ["portuguese", "regional", "traditional"],
  seafood: ["seafood", "fish"],
  burger: ["burger"],
  steak: ["steak_house", "grill", "barbecue"],
  brazilian: ["brazilian"],
  tapas: ["tapas"],
  mediterranean: ["mediterranean"],
  vegetarian: ["vegetarian", "vegan"],
  vegan: ["vegan", "vegetarian"],
  dessert: ["dessert", "ice_cream", "cake", "pastry"],
  coffee: ["coffee_shop", "cafe"],
  breakfast: ["breakfast", "brunch"],
};

function candidate(v: ResolvedVenue, why: string, km: number): Candidate {
  return {
    title: v.name,
    body: `${why} · about ${km.toFixed(km < 10 ? 1 : 0)} km from your home base`,
    kind: "outing",
    where: v.address ?? v.subcategory.replace(/_/g, " "),
    url: v.sourceUrl,
    verified_source: `planbuddy:openstreetmap-catalogue ${v.sourceUrl}`,
  };
}

export async function suggestFor(userId: string, entity: { type?: string; canonical?: string }, loc: Loc): Promise<Candidate[]> {
  const canonical = typeof entity?.canonical === "string" ? entity.canonical.trim() : "";
  const type = entity?.type;
  if (!canonical || canonical.length > 120) return [];
  const user = await getUserById(userId);
  if (!user || user.homeBaseLat == null || user.homeBaseLng == null) return [];
  const home = { lat: user.homeBaseLat, lng: user.homeBaseLng };
  const catalog = await readLisbonBootstrap(home.lat, home.lng);
  if (!catalog.length) return [];
  const maxKm = radiusForScale("weekend", user);
  const near = (v: ResolvedVenue) => distanceKm(home, v);
  const q = norm(canonical);
  const pt = loc === "pt-PT" ? 1 : 0;
  let picked: { v: ResolvedVenue; why: string }[] = [];

  if (type === "place") {
    picked = catalog.filter((v) => norm(v.name) === q).slice(0, 1).map((v) => ({ v, why: v.subcategory.replace(/_/g, " ") }));
  } else if (type === "cuisine") {
    const tags = CUISINE_TAGS[q] ?? [q.replace(/ /g, "_")];
    picked = catalog
      .filter((v) => v.category === "food" && v.tags.some((tg) => tags.includes(tg)))
      .map((v) => ({ v, d: near(v) }))
      .filter((x) => x.d <= maxKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .map((x) => ({ v: x.v, why: `${canonical} ${pt ? "perto de ti" : "restaurant"}` }));
  } else if (type === "topic" || type === "activity") {
    const rule = RULES.find((r) => r.words.test(q));
    if (rule) {
      picked = catalog
        .filter((v) => (rule.nameRe && rule.nameRe.test(norm(v.name)) && v.category === "activity") || (rule.subcategories?.includes(v.subcategory) && !rule.nameRe))
        .map((v) => ({ v, d: near(v) }))
        .filter((x) => x.d <= maxKm)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map((x) => ({ v: x.v, why: rule.label[pt] }));
    }
  }
  // artist / title / person / goal: the catalogue has no events or media, so nothing is verifiable -> empty
  return picked.map(({ v, why }) => candidate(v, why, near(v))).filter((c) => c.title && c.verified_source);
}

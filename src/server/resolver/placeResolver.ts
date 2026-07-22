import { getDb } from "../db/client.js";
import { stringifyJsonForDb } from "../db/json.js";
import { logger } from "../logger.js";
import { isTest } from "../env.js";
import fs from "node:fs/promises";

export interface ResolvedVenue {
  id: string;
  name: string;
  category: "food" | "outdoor" | "activity";
  subcategory: string;
  lat: number;
  lng: number;
  openNow: boolean | null;
  sourceUrl: string;
  address: string | null;
  tags: string[];
}

export interface PlaceResolverResult {
  mode: "inspiration" | "resolved";
  venues: ResolvedVenue[];
}

interface CacheRow {
  payload: ResolvedVenue[] | string;
  fetched_at: string | Date;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

const OVERPASS_URLS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
] as const;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COLD_WAIT_MS = 3500;
const MIN_USEFUL_VENUES = 30;
const inFlight = new Map<string, Promise<ResolvedVenue[]>>();
let lisbonBootstrap: ResolvedVenue[] | null = null;

function cacheKey(lat: number, lng: number, radiusKm: number): string {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}:${Math.round(radiusKm)}`;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parsePayload(value: ResolvedVenue[] | string): ResolvedVenue[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ResolvedVenue[] : [];
  } catch {
    return [];
  }
}

function addressFromTags(tags: Record<string, string>): string | null {
  if (tags["addr:full"]) return tags["addr:full"];
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const locality = [tags["addr:city"], tags["addr:postcode"]].filter(Boolean).join(" ");
  return [street, locality].filter(Boolean).join(", ") || null;
}

function classify(tags: Record<string, string>): Pick<ResolvedVenue, "category" | "subcategory"> | null {
  const amenity = tags.amenity;
  if (amenity && /^(restaurant|cafe|biergarten|food_court)$/.test(amenity)) {
    return { category: "food", subcategory: amenity };
  }
  const leisure = tags.leisure;
  if (leisure && /^(park|garden|nature_reserve)$/.test(leisure)) {
    return { category: "outdoor", subcategory: leisure };
  }
  const natural = tags.natural;
  if (natural && /^(beach|wood|peak)$/.test(natural)) {
    return { category: "outdoor", subcategory: natural };
  }
  const tourism = tags.tourism;
  if (tourism && /^(attraction|museum|viewpoint|gallery|zoo|theme_park)$/.test(tourism)) {
    return { category: tourism === "viewpoint" ? "outdoor" : "activity", subcategory: tourism };
  }
  return null;
}

function searchableTags(tags: Record<string, string>): string[] {
  return Array.from(new Set([
    tags.amenity,
    tags.leisure,
    tags.natural,
    tags.tourism,
    ...(tags.cuisine ?? "").split(/[;,]/),
    tags.outdoor_seating === "yes" ? "outdoor seating" : null,
    tags.dog === "yes" ? "dog friendly" : null,
    tags.wheelchair === "yes" ? "wheelchair" : null,
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim().toLowerCase())));
}

export function overpassQuery(lat: number, lng: number, radiusKm: number): string {
  const radiusM = Math.max(1000, Math.min(60_000, Math.round(radiusKm * 1000)));
  const around = `around:${radiusM},${lat.toFixed(5)},${lng.toFixed(5)}`;
  return `[out:json][timeout:25];(` +
    `nwr(${around})["name"]["amenity"~"restaurant|cafe|biergarten|food_court"];` +
    `nwr(${around})["name"]["leisure"~"park|garden|nature_reserve"];` +
    `nwr(${around})["name"]["tourism"~"attraction|museum|viewpoint|gallery|zoo|theme_park"];` +
    `nwr(${around})["name"]["natural"~"beach|wood|peak"];` +
    `);out center tags;`;
}

export async function fetchOverpassCatalog(lat: number, lng: number, radiusKm: number): Promise<ResolvedVenue[]> {
  const failures: string[] = [];
  for (const endpoint of OVERPASS_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 32_000);
    try {
      const url = new URL(endpoint);
      url.searchParams.set("data", overpassQuery(lat, lng, radiusKm));
      const response = await fetch(url, {
        headers: { "User-Agent": "PlanBuddy/1.2 place discovery" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { elements?: OverpassElement[] };
      return parseOverpassElements(data.elements ?? []);
    } catch (error) {
      failures.push(`${new URL(endpoint).hostname}: ${String(error)}`);
      logger.warn("Overpass mirror failed; trying the next mirror", {
        endpoint: new URL(endpoint).hostname,
        error: String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`All Overpass mirrors failed (${failures.join("; ")})`);
}

export function parseOverpassElements(elements: OverpassElement[]): ResolvedVenue[] {
  const seen = new Set<string>();
  const venues: ResolvedVenue[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    const classification = classify(tags);
    if (!name || name.length > 160 || lat == null || lng == null || !classification) continue;
    const duplicateKey = `${normalizeName(name)}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    if (!normalizeName(name) || seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    venues.push({
      id: `${element.type}/${element.id}`,
      name,
      ...classification,
      lat,
      lng,
      openNow: null,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      address: addressFromTags(tags),
      tags: searchableTags(tags),
    });
  }
  return venues;
}

async function readCache(key: string): Promise<{ venues: ResolvedVenue[]; fresh: boolean } | null> {
  const db = await getDb();
  const { rows } = await db.query<CacheRow>(
    `SELECT payload, fetched_at FROM place_catalog_cache WHERE cache_key = $1 LIMIT 1`,
    [key]
  );
  const row = rows[0];
  if (!row) return null;
  const venues = parsePayload(row.payload);
  return {
    venues,
    fresh: Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS,
  };
}

function isLisbonArea(lat: number, lng: number): boolean {
  return Math.abs(lat - 38.7223) < 0.75 && Math.abs(lng - -9.1393) < 0.9;
}

export async function readLisbonBootstrap(lat: number, lng: number): Promise<ResolvedVenue[]> {
  if (!isLisbonArea(lat, lng)) return [];
  if (lisbonBootstrap) return lisbonBootstrap;
  try {
    const raw = await fs.readFile(new URL("./data/lisbon-catalog.json", import.meta.url), "utf8");
    lisbonBootstrap = parsePayload(raw);
    return lisbonBootstrap;
  } catch (error) {
    logger.warn("Bundled Lisbon place catalogue unavailable", { error: String(error) });
    return [];
  }
}

async function storeCatalog(key: string, lat: number, lng: number, radiusKm: number, venues: ResolvedVenue[]): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO place_catalog_cache (cache_key, center_lat, center_lng, radius_km, payload, fetched_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (cache_key) DO UPDATE SET
       center_lat = EXCLUDED.center_lat,
       center_lng = EXCLUDED.center_lng,
       radius_km = EXCLUDED.radius_km,
       payload = EXCLUDED.payload,
       fetched_at = now()`,
    [key, lat, lng, radiusKm, stringifyJsonForDb(venues)]
  );
}

async function refreshCatalog(key: string, lat: number, lng: number, radiusKm: number): Promise<ResolvedVenue[]> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const venues = await fetchOverpassCatalog(lat, lng, radiusKm);
    if (venues.length < MIN_USEFUL_VENUES) throw new Error(`Place catalog too small: ${venues.length}`);
    await storeCatalog(key, lat, lng, radiusKm, venues);
    logger.info("Place catalog refreshed", { key, venueCount: venues.length });
    return venues;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function wait(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref();
  });
}

export async function resolvePlaces(lat: number, lng: number, radiusKm: number): Promise<PlaceResolverResult> {
  if (isTest) return { mode: "inspiration", venues: [] };
  // A single 60 km local catalogue serves every smaller control setting;
  // the route composer applies the user's exact radius. This avoids a slow
  // external fetch merely because someone moves the radius slider.
  const catalogRadiusKm = radiusKm <= 60 ? 60 : radiusKm;
  const key = cacheKey(lat, lng, catalogRadiusKm);
  try {
    const cached = await readCache(key);
    if (cached && cached.venues.length >= MIN_USEFUL_VENUES) {
      if (!cached.fresh) {
        void refreshCatalog(key, lat, lng, catalogRadiusKm).catch((error) =>
          logger.warn("Background place catalog refresh failed", { key, error: String(error) })
        );
      }
      return { mode: "resolved", venues: cached.venues };
    }
    const bootstrap = await readLisbonBootstrap(lat, lng);
    if (bootstrap.length >= MIN_USEFUL_VENUES) {
      await storeCatalog(key, lat, lng, catalogRadiusKm, bootstrap);
      logger.info("Seeded place catalog from bundled Lisbon snapshot", { key, venueCount: bootstrap.length });
      return { mode: "resolved", venues: bootstrap };
    }
    const refreshed = await Promise.race([refreshCatalog(key, lat, lng, catalogRadiusKm), wait(COLD_WAIT_MS)]);
    return refreshed && refreshed.length >= MIN_USEFUL_VENUES
      ? { mode: "resolved", venues: refreshed }
      : { mode: "inspiration", venues: [] };
  } catch (error) {
    logger.warn("Place catalog unavailable; keeping the bounded planner fallback", { key, error: String(error) });
    return { mode: "inspiration", venues: [] };
  }
}

export async function warmPlaceCatalog(lat: number, lng: number, radiusKm: number): Promise<void> {
  const key = cacheKey(lat, lng, radiusKm);
  const cached = await readCache(key);
  if (cached?.fresh && cached.venues.length >= MIN_USEFUL_VENUES) return;
  const bootstrap = await readLisbonBootstrap(lat, lng);
  if (bootstrap.length >= MIN_USEFUL_VENUES) {
    await storeCatalog(key, lat, lng, radiusKm, bootstrap);
    logger.info("Seeded place catalog from bundled Lisbon snapshot", { key, venueCount: bootstrap.length });
    return;
  }
  await refreshCatalog(key, lat, lng, radiusKm);
}

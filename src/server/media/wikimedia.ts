import { logger } from "../logger.js";
import type { PlanImage } from "../../shared/types.js";

const API_URL = "https://commons.wikimedia.org/w/api.php";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { value: PlanImage | null; expiresAt: number }>();

function cleanHtml(value: string | undefined): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface CommonsImageInfo {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value?: string }>;
}

interface CommonsPage {
  index?: number;
  title?: string;
  imageinfo?: CommonsImageInfo[];
}

export async function resolveWikimediaImage(
  searchTerm: string | null | undefined,
  fallbackSearchTerm?: string | null
): Promise<PlanImage | null> {
  const terms = Array.from(
    new Set([searchTerm?.trim(), fallbackSearchTerm?.trim()].filter((value): value is string => Boolean(value)))
  );
  if (terms.length === 0) return null;
  const term = terms[0];
  const key = terms.map((value) => value.toLowerCase()).join("|");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    // Search the exact route anchor and the broader home city in parallel.
    // This keeps photography bounded to one network window while ensuring an
    // obscure park name cannot leave the whole ticket without a hero.
    const results = await Promise.all(terms.map((candidateTerm) => searchWikimedia(candidateTerm)));
    const value = results.find((candidate): candidate is PlanImage => Boolean(candidate)) ?? null;
    if (value) {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
    cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  } catch (error) {
    logger.warn("Wikimedia image lookup failed", { error: String(error), searchTerm: term });
    cache.set(key, { value: null, expiresAt: Date.now() + 10 * 60 * 1000 });
    return null;
  }
}

async function searchWikimedia(term: string): Promise<PlanImage | null> {
  try {
    const searchUrl = new URL(API_URL);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("generator", "search");
    searchUrl.searchParams.set("gsrsearch", term);
    searchUrl.searchParams.set("gsrnamespace", "6");
    searchUrl.searchParams.set("gsrlimit", "10");
    searchUrl.searchParams.set("prop", "imageinfo");
    searchUrl.searchParams.set("iiprop", "url|extmetadata");
    searchUrl.searchParams.set("iiurlwidth", "1200");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("origin", "*");

    const response = await fetch(searchUrl, {
      // Photography is optional polish and must never hold the plan hostage.
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": "PlanBuddy/0.1.1 (https://planbuddy.onrender.com)" },
    });
    if (!response.ok) throw new Error(`Wikimedia Commons search failed: ${response.status}`);
    const data = (await response.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const page = Object.values(data.query?.pages ?? {})
      .filter((item) => item.imageinfo?.[0]?.thumburl || item.imageinfo?.[0]?.url)
      .filter((item) => imageIsRelevant(item, term))
      .sort((a, b) => imageScore(b) - imageScore(a))[0];
    const imageInfo = page?.imageinfo?.[0];
    if (!page || (!imageInfo?.thumburl && !imageInfo?.url)) {
      return null;
    }

    const metadata = imageInfo.extmetadata ?? {};
    const artist = cleanHtml(metadata.Artist?.value) || cleanHtml(metadata.Credit?.value) || "Wikimedia contributors";
    const license = cleanHtml(metadata.LicenseShortName?.value);
    const rawTitle = (page.title ?? term).replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    const title = rawTitle.length > 180 ? `${rawTitle.slice(0, 176).trimEnd()}\u2026` : rawTitle;
    return {
      url: imageInfo.thumburl ?? imageInfo.url!,
      sourceUrl: imageInfo.descriptionurl ?? "https://commons.wikimedia.org/",
      attribution: [artist, license].filter(Boolean).join(" / "),
      caption: title,
    };
  } catch (error) {
    logger.warn("Wikimedia image search attempt failed", { error: String(error), searchTerm: term });
    return null;
  }
}

function normalizedWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function imageIsRelevant(page: CommonsPage, searchTerm: string): boolean {
  const title = (page.title ?? "").replace(/^File:/, "");
  if (/\.(?:pdf|djvu|tiff?|svg)$/i.test(title)) return false;
  if (/\b(?:book cover|scanned|page \d+|through portugal)\b/i.test(title)) return false;
  const genericWords = new Set([
    "portugal", "parque", "park", "jardim", "garden", "museum", "museu",
    "city", "landscape", "view", "photo",
  ]);
  const meaningfulQueryWords = normalizedWords(searchTerm)
    .filter((word) => word.length >= 4 && !genericWords.has(word));
  if (meaningfulQueryWords.length === 0) return true;
  const normalizedTitle = normalizedWords(title).join(" ");
  return meaningfulQueryWords.some((word) => normalizedTitle.includes(word));
}

function imageScore(page: CommonsPage): number {
  const title = (page.title ?? "").toLowerCase();
  const landscapeBonus = /landscape|panoram|garden view|park view|trees reflected|pond|lake|promenade|skyline|empty parque|park lisbon/.test(title)
    ? 20
    : 0;
  const detailPenalty = /\bfly\b|insect|close-up|flower|periwinkle|bamboo|carved|bird|beetle|sculpture|azulejo|tile|flag|column|ferris/.test(title)
    ? 20
    : 0;
  return landscapeBonus - detailPenalty + (11 - (page.index ?? 10)) / 10;
}

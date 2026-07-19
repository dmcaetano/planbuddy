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

export async function resolveWikimediaImage(searchTerm: string | null | undefined): Promise<PlanImage | null> {
  const term = searchTerm?.trim();
  if (!term) return null;
  const key = term.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const localizedSearchTerm = /\blisbo(?:n|a)\b/i.test(term) ? term : `${term} Lisbon`;
    const searchUrl = new URL(API_URL);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("generator", "search");
    searchUrl.searchParams.set("gsrsearch", localizedSearchTerm);
    searchUrl.searchParams.set("gsrnamespace", "6");
    searchUrl.searchParams.set("gsrlimit", "10");
    searchUrl.searchParams.set("prop", "imageinfo");
    searchUrl.searchParams.set("iiprop", "url|extmetadata");
    searchUrl.searchParams.set("iiurlwidth", "1200");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("origin", "*");

    const response = await fetch(searchUrl, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "PlanBuddy/0.1.1 (https://planbuddy.onrender.com)" },
    });
    if (!response.ok) throw new Error(`Wikimedia Commons search failed: ${response.status}`);
    const data = (await response.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const page = Object.values(data.query?.pages ?? {})
      .filter((item) => item.imageinfo?.[0]?.thumburl || item.imageinfo?.[0]?.url)
      .sort((a, b) => imageScore(b) - imageScore(a))[0];
    const imageInfo = page?.imageinfo?.[0];
    if (!page || (!imageInfo?.thumburl && !imageInfo?.url)) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const metadata = imageInfo.extmetadata ?? {};
    const artist = cleanHtml(metadata.Artist?.value) || cleanHtml(metadata.Credit?.value) || "Wikimedia contributors";
    const license = cleanHtml(metadata.LicenseShortName?.value);
    const rawTitle = (page.title ?? term).replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    const title = rawTitle.length > 180 ? `${rawTitle.slice(0, 176).trimEnd()}\u2026` : rawTitle;
    const value: PlanImage = {
      url: imageInfo.thumburl ?? imageInfo.url!,
      sourceUrl: imageInfo.descriptionurl ?? "https://commons.wikimedia.org/",
      attribution: [artist, license].filter(Boolean).join(" / "),
      caption: title,
    };
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    logger.warn("Wikimedia image lookup failed", { error: String(error), searchTerm: term });
    cache.set(key, { value: null, expiresAt: Date.now() + 10 * 60 * 1000 });
    return null;
  }
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

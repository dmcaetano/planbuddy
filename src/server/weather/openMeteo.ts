import { logger } from "../logger.js";
import type { WeatherSnapshot } from "../../shared/types.js";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  country: string | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const forecastCache = new Map<string, CacheEntry<WeatherSnapshot>>();
const geocodeCache = new Map<string, CacheEntry<GeocodeResult[]>>();

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

export async function geocodeCity(query: string): Promise<GeocodeResult[]> {
  const key = query.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("name", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const res = await fetch(url, { signal: withTimeout(5000) });
    if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
    const data = (await res.json()) as {
      results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
    };
    const results: GeocodeResult[] = (data.results ?? []).map((r) => ({
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude,
      lng: r.longitude,
      country: r.country ?? null,
    }));
    geocodeCache.set(key, { value: results, expiresAt: Date.now() + CACHE_TTL_MS });
    return results;
  } catch (err) {
    logger.warn("Open-Meteo geocoding failed", { error: String(err) });
    return [];
  }
}

export async function getForecast(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string
): Promise<WeatherSnapshot> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${startDate},${endDate}`;
  const cached = forecastCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const unavailable: WeatherSnapshot = {
    temperatureC: null,
    precipitationProbability: null,
    summary: "Weather unavailable",
    unavailable: true,
  };

  try {
    const url = new URL(FORECAST_URL);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("daily", "temperature_2m_max,precipitation_probability_max");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    const res = await fetch(url, { signal: withTimeout(5000) });
    if (!res.ok) throw new Error(`Forecast failed: ${res.status}`);
    const data = (await res.json()) as {
      daily?: { temperature_2m_max?: number[]; precipitation_probability_max?: number[] };
    };
    const temps = data.daily?.temperature_2m_max ?? [];
    const precs = data.daily?.precipitation_probability_max ?? [];
    if (temps.length === 0) {
      forecastCache.set(key, { value: unavailable, expiresAt: Date.now() + CACHE_TTL_MS });
      return unavailable;
    }
    const temperatureC = Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10;
    const precipitationProbability =
      precs.length > 0 ? Math.round(precs.reduce((a, b) => a + b, 0) / precs.length) : null;
    const summary = describeWeather(temperatureC, precipitationProbability);
    const snapshot: WeatherSnapshot = {
      temperatureC,
      precipitationProbability,
      summary,
      unavailable: false,
    };
    forecastCache.set(key, { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
    return snapshot;
  } catch (err) {
    logger.warn("Open-Meteo forecast failed", { error: String(err) });
    return unavailable;
  }
}

function describeWeather(tempC: number, precipProb: number | null): string {
  const tempWord = tempC >= 26 ? "hot" : tempC >= 18 ? "mild" : tempC >= 8 ? "cool" : "cold";
  const rainWord = precipProb != null && precipProb >= 50 ? "likely rain" : "mostly dry";
  return `${tempWord}, ${Math.round(tempC)}°C, ${rainWord}`;
}

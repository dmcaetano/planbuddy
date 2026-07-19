import { logger } from "../logger.js";
import type { WeatherSnapshot } from "../../shared/types.js";
import { isTest } from "../env.js";

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

const unavailableForecast: WeatherSnapshot = {
  temperatureC: null,
  temperatureMinC: null,
  apparentTemperatureC: null,
  precipitationProbability: null,
  windSpeedKph: null,
  uvIndex: null,
  sunrise: null,
  sunset: null,
  summary: "Weather unavailable",
  unavailable: true,
};

export async function getForecast(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string
): Promise<WeatherSnapshot> {
  if (isTest) return unavailableForecast;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${startDate},${endDate}`;
  const cached = forecastCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const url = new URL(FORECAST_URL);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset"
    );
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    const res = await fetch(url, { signal: withTimeout(6000) });
    if (!res.ok) throw new Error(`Forecast failed: ${res.status}`);
    const data = (await res.json()) as {
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        apparent_temperature_max?: number[];
        precipitation_probability_max?: number[];
        wind_speed_10m_max?: number[];
        uv_index_max?: number[];
        sunrise?: string[];
        sunset?: string[];
      };
    };
    const temps = data.daily?.temperature_2m_max ?? [];
    if (!temps.length) {
      forecastCache.set(key, { value: unavailableForecast, expiresAt: Date.now() + CACHE_TTL_MS });
      return unavailableForecast;
    }

    const round1 = (value: number) => Math.round(value * 10) / 10;
    const maxOrNull = (values: number[]) => (values.length ? round1(Math.max(...values)) : null);
    const minOrNull = (values: number[]) => (values.length ? round1(Math.min(...values)) : null);
    const temperatureC = maxOrNull(temps)!;
    const precipitationProbability = maxOrNull(data.daily?.precipitation_probability_max ?? []);
    const snapshot: WeatherSnapshot = {
      temperatureC,
      temperatureMinC: minOrNull(data.daily?.temperature_2m_min ?? []),
      apparentTemperatureC: maxOrNull(data.daily?.apparent_temperature_max ?? []),
      precipitationProbability,
      windSpeedKph: maxOrNull(data.daily?.wind_speed_10m_max ?? []),
      uvIndex: maxOrNull(data.daily?.uv_index_max ?? []),
      sunrise: timeOnly(data.daily?.sunrise?.[0]),
      sunset: timeOnly(data.daily?.sunset?.[0]),
      summary: describeWeather(temperatureC, precipitationProbability),
      unavailable: false,
    };
    forecastCache.set(key, { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
    return snapshot;
  } catch (err) {
    logger.warn("Open-Meteo forecast failed", { error: String(err) });
    return unavailableForecast;
  }
}

function describeWeather(tempC: number, precipProb: number | null): string {
  const tempWord = tempC >= 26 ? "hot" : tempC >= 18 ? "mild" : tempC >= 8 ? "cool" : "cold";
  const rainWord = precipProb != null && precipProb >= 50 ? "likely rain" : "mostly dry";
  return `${tempWord}, ${Math.round(tempC)}°C, ${rainWord}`;
}

function timeOnly(value: string | undefined): string | null {
  const time = value?.split("T")[1];
  return time ? time.slice(0, 5) : null;
}

import type { AiCandidate } from "../../../shared/schemas.js";
import type { Participant, PreparationGuide, WeatherSnapshot } from "../../../shared/types.js";
import { resolveWikimediaImage } from "../../media/wikimedia.js";

function placeQuery(place: NonNullable<AiCandidate["beats"][number]["place"]>): string {
  return [place.name, place.address].filter(Boolean).join(", ");
}

function mapsSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  return url.toString();
}

function mapsDirectionsUrl(origin: string, destination: string, mode: string | null | undefined): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", mode === "ferry" ? "transit" : mode || "walking");
  return url.toString();
}

function fullWalkingRouteUrl(queries: string[]): string | null {
  if (queries.length < 2) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", queries[0]);
  url.searchParams.set("destination", queries.at(-1)!);
  url.searchParams.set("travelmode", "walking");
  if (queries.length > 2) url.searchParams.set("waypoints", queries.slice(1, -1).join("|"));
  return url.toString();
}

function preparationGuide(weather: WeatherSnapshot, participants: Participant[]): PreparationGuide {
  const high = weather.apparentTemperatureC ?? weather.temperatureC;
  const rain = weather.precipitationProbability;
  const wind = weather.windSpeedKph;
  const uv = weather.uvIndex;
  const pets = participants.filter((p) => p.kind === "pet");

  const wear = ["Cushioned walking shoes with grip for Lisbon's smooth stone paving."];
  const bring: string[] = [];
  const pet: string[] = [];

  if (high != null && high >= 24) {
    wear.unshift("A light, breathable top with loose shorts, skirt, or lightweight trousers.");
    wear.push("A brimmed hat or cap; choose pale colors for exposed waterfront stretches.");
  } else if (high != null && high <= 17) {
    wear.unshift("A comfortable base layer with a light jacket you can remove while walking.");
  } else {
    wear.unshift("Breathable layers that stay comfortable through dinner and an easy walk.");
  }
  if (weather.sunset) wear.push("A thin overshirt or packable layer for the cooler post-sunset stroll.");
  if (wind != null && wind >= 22) wear.push("A thin wind-resistant layer for the exposed final stroll.");
  if (rain != null && rain >= 35) bring.push("A compact umbrella or packable rain shell.");
  if ((uv ?? 0) >= 5 || (high ?? 0) >= 24) bring.push("SPF 30+ sunscreen and sunglasses; reapply before the walk.");
  bring.push("A refillable water bottle and any personal medication you may need.");

  if (pets.length) {
    const petLabel = pets.map((p) => p.name).join(" and ");
    pet.push(`Harness and short ordinary lead for ${petLabel}; avoid a retractable lead around roads and terraces.`);
    pet.push("Collapsible bowl, 500–750 ml of water, waste bags, and a small mat for under the table.");
    pet.push("Carrier or sling as a tiredness/heat backup, especially for a small dog.");
    if ((high ?? 0) >= 26) {
      pet.push("Cooling bandana or damp cloth; keep to shade/grass and test paving with the back of your hand.");
    }
  }

  let weatherRule = "Check the live forecast and venue status again on the day; shorten exposed walking if conditions change.";
  if (high != null && high >= 30) {
    weatherRule = `Feels-like temperature may reach ${Math.round(high)}°C. If paving is still hot or it remains above 28–30°C at departure, skip the first walk and begin after the meal when it is cooler.`;
  } else if (rain != null && rain >= 50) {
    weatherRule = `Rain risk is about ${Math.round(rain)}%. Keep the route flexible and use the listed fallback if the exposed walk is uncomfortable.`;
  }

  return { wear, bring, pet, weatherRule };
}

function ensureOperationalChecks(
  checks: string[],
  beats: AiCandidate["beats"],
  hasPet: boolean
): string[] {
  const result = [...checks];
  const mealBeat = beats.find((beat) => /food|meal|dinner|lunch|restaurant/i.test(`${beat.category} ${beat.title}`));
  const venue = mealBeat?.place?.name ?? "the meal venue";
  if (!result.some((item) => /hour|open/i.test(item))) {
    result.push(`Recheck ${venue}'s Saturday opening hours on the linked source before leaving.`);
  }
  if (!result.some((item) => /reserv|terrace|table/i.test(item))) {
    result.push(`Reserve the requested meal time and confirm an outdoor terrace table at ${venue}.`);
  }
  if (hasPet && !result.some((item) => /pet|dog|pom/i.test(item))) {
    result.push(`Confirm directly that ${venue}'s terrace accepts your Pom; online listings can be out of date.`);
  }
  if (!result.some((item) => /price|menu|cost|€|order/i.test(item))) {
    result.push(`Check the current menu and prices; keep the order inside the displayed per-person estimate.`);
  }
  return result.slice(0, 8);
}

function normalizeLisbonGeographyText(text: string): string {
  return text
    .replace(/\blakeside\b/gi, "garden-side")
    .replace(/\blakes\b/gi, "ornamental ponds")
    .replace(/\blake\b/gi, "ornamental pond");
}

function normalizeLisbonGeography(candidate: AiCandidate, homeBaseLabel: string | null): AiCandidate {
  if (!/lisbo[an]|lisbon/i.test(homeBaseLabel ?? "")) return candidate;
  const normalizePlace = (place: AiCandidate["beats"][number]["place"]) =>
    place ? { ...place, factualNote: normalizeLisbonGeographyText(place.factualNote) } : place;
  return {
    ...candidate,
    title: normalizeLisbonGeographyText(candidate.title),
    rationale: normalizeLisbonGeographyText(candidate.rationale),
    photoSearchTerm: candidate.photoSearchTerm ? normalizeLisbonGeographyText(candidate.photoSearchTerm) : candidate.photoSearchTerm,
    beats: candidate.beats.map((beat) => ({
      ...beat,
      title: normalizeLisbonGeographyText(beat.title),
      description: normalizeLisbonGeographyText(beat.description),
      place: normalizePlace(beat.place),
    })),
    checkBeforeYouGo: candidate.checkBeforeYouGo.map(normalizeLisbonGeographyText),
    fallback: candidate.fallback
      ? {
          ...candidate.fallback,
          title: normalizeLisbonGeographyText(candidate.fallback.title),
          description: normalizeLisbonGeographyText(candidate.fallback.description),
          place: normalizePlace(candidate.fallback.place),
        }
      : candidate.fallback,
  };
}

function parseClockMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClockMinutes(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function normalizeBeatStartTimes(beats: AiCandidate["beats"]): AiCandidate["beats"] {
  let previousEnd: number | null = null;
  return beats.map((beat) => {
    const statedStart = parseClockMinutes(beat.startTime);
    const earliestStart = previousEnd == null ? null : previousEnd + (beat.travelMinutes ?? 0);
    const start = statedStart == null ? earliestStart : earliestStart == null ? statedStart : Math.max(statedStart, earliestStart);
    if (start == null) return beat;
    previousEnd = start + (beat.durationMinutes ?? 0);
    return { ...beat, startTime: formatClockMinutes(start) };
  });
}

export async function enrichCandidate(
  candidate: AiCandidate,
  input: {
    homeBaseLabel: string | null;
    weather: WeatherSnapshot;
    participants: Participant[];
    walkingTargetMinutes?: { min: number; max: number } | null;
  }
): Promise<AiCandidate> {
  const groundedCopy = normalizeLisbonGeography(candidate, input.homeBaseLabel);
  const normalizedBeats = normalizeBeatStartTimes(
    normalizeWalkingDuration(groundedCopy.beats, input.walkingTargetMinutes)
  );
  let previous = input.homeBaseLabel || "Current location";
  const queries: string[] = [];
  const beats = normalizedBeats.map((beat) => {
    if (!beat.place) return { ...beat, directionsUrl: null };
    const query = placeQuery(beat.place);
    queries.push(query);
    const directionsUrl = mapsDirectionsUrl(previous, query, beat.travelMode);
    previous = query;
    return {
      ...beat,
      place: { ...beat.place, mapsUrl: mapsSearchUrl(query) },
      directionsUrl,
    };
  });

  const fallback = groundedCopy.fallback?.place
    ? {
        ...groundedCopy.fallback,
        place: {
          ...groundedCopy.fallback.place,
          mapsUrl: mapsSearchUrl(placeQuery(groundedCopy.fallback.place)),
        },
      }
    : groundedCopy.fallback ?? null;

  const heroImage = await resolveWikimediaImage(groundedCopy.photoSearchTerm);
  const walkingMetrics = calculateWalkingMetrics(beats, groundedCopy.walkingMinutes, groundedCopy.walkingDistanceKm);
  return {
    ...groundedCopy,
    beats,
    checkBeforeYouGo: ensureOperationalChecks(
      groundedCopy.checkBeforeYouGo,
      beats,
      input.participants.some((participant) => participant.kind === "pet")
    ),
    fallback,
    heroImage,
    routeMapsUrl: fullWalkingRouteUrl(queries),
    preparation: preparationGuide(input.weather, input.participants),
    walkingMinutes: walkingMetrics.minutes,
    walkingDistanceKm: walkingMetrics.distanceKm,
  };
}

function calculateWalkingMetrics(
  beats: AiCandidate["beats"],
  modelMinutes: number | null | undefined,
  modelDistanceKm: number | null | undefined
): { minutes: number | null; distanceKm: number | null } {
  let minutes = 0;
  let distanceKm = 0;
  let hasMetrics = false;
  for (const beat of beats) {
    if (isWalkingBeat(beat) && beat.durationMinutes) {
      minutes += beat.durationMinutes;
      distanceKm += beat.durationMinutes * 0.065;
      hasMetrics = true;
    }
    if (beat.travelMode === "walking" && beat.travelMinutes != null) {
      minutes += beat.travelMinutes;
      distanceKm += beat.distanceFromPreviousKm ?? beat.travelMinutes * 0.065;
      hasMetrics = true;
    }
  }
  if (!hasMetrics) return { minutes: modelMinutes ?? null, distanceKm: modelDistanceKm ?? null };
  return {
    minutes,
    distanceKm: Math.round(distanceKm * 10) / 10,
  };
}

function isWalkingBeat(beat: AiCandidate["beats"][number]): boolean {
  // Titles and descriptions often contain connective language such as
  // "walk over for dinner" or "pre-dinner greenery". Only structural fields
  // should decide that the activity itself is a meal rather than a walk.
  if (/food|meal|dinner|lunch|restaurant|dining|cafe|café/i.test(`${beat.category} ${beat.place?.kind ?? ""}`)) {
    return false;
  }
  return /walk|stroll|hike|promenade|wander|park|garden|viewpoint|miradouro|jardim/i.test(
    `${beat.title} ${beat.category} ${beat.description} ${beat.place?.kind ?? ""}`
  );
}

function normalizeWalkingDuration(
  beats: AiCandidate["beats"],
  target: { min: number; max: number } | null | undefined
): AiCandidate["beats"] {
  if (!target) return beats;
  const walkingIndexes = beats
    .map((beat, index) => (isWalkingBeat(beat) ? index : -1))
    .filter((index) => index >= 0);
  if (!walkingIndexes.length) return beats;

  const transferMinutes = beats.reduce(
    (sum, beat) => sum + (beat.travelMode === "walking" ? beat.travelMinutes ?? 0 : 0),
    0
  );
  const activityMinutes = walkingIndexes.reduce((sum, index) => sum + (beats[index].durationMinutes ?? 0), 0);
  const total = transferMinutes + activityMinutes;
  if (total >= target.min && total <= target.max) return beats;

  // Five minutes is the schema floor and still represents an intentional
  // pause/loop at the named green stop. Use it when point-to-point walking
  // already consumes most of the household's remembered total-walk budget.
  const minimumPerWalk = 5;
  const activityBudget = Math.max(walkingIndexes.length * minimumPerWalk, target.max - transferMinutes);
  const currentWeights = walkingIndexes.map((index) =>
    Math.max(minimumPerWalk, beats[index].durationMinutes ?? minimumPerWalk)
  );
  const weightTotal = currentWeights.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return beats.map((beat, index) => {
    const walkingPosition = walkingIndexes.indexOf(index);
    if (walkingPosition < 0) return beat;
    const isLast = walkingPosition === walkingIndexes.length - 1;
    const durationMinutes = isLast
      ? activityBudget - allocated
      : Math.max(minimumPerWalk, Math.round((activityBudget * currentWeights[walkingPosition]) / weightTotal));
    allocated += durationMinutes;
    return { ...beat, durationMinutes };
  });
}

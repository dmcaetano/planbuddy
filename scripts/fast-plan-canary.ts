import { generateCandidates } from "../src/server/ai/index.js";

const context = {
  scale: "day_off" as const,
  startDate: "2026-07-25",
  endDate: "2026-07-25",
  homeBaseLabel: "Lisbon, Lisbon District, Portugal",
  homeBaseLat: 38.7223,
  homeBaseLng: -9.1393,
  participants: [
    { name: "Diogo", kind: "person" as const, relationship: "self" },
    { name: "Pom", kind: "pet" as const, relationship: "dog" },
  ],
  weather: {
    temperatureC: 24,
    temperatureMinC: 18,
    apparentTemperatureC: 25,
    precipitationProbability: 10,
    windSpeedKph: 14,
    uvIndex: 6,
    sunrise: "06:30",
    sunset: "20:55",
    summary: "Warm and dry",
    unavailable: false,
  },
  moodContext: "A little walk, grilled fish or meat, and a soft stroll with my Pom",
  radiusKm: 60,
  activeConstraints: [{ id: "canary-gluten", text: "gluten intolerance" }],
  loveTastes: [],
  avoidTastes: [],
  preferenceHunches: [],
  recentSuggestions: [],
  seed: "live-fast-canary",
};

const startedAt = Date.now();
const result = await generateCandidates(context);
const candidate = result.response.candidates[0];

console.log(JSON.stringify({
  elapsedMs: Date.now() - startedAt,
  mode: result.mode,
  title: candidate?.title,
  beats: candidate?.beats.map((beat) => beat.place?.name ?? beat.title),
  citations: candidate?.citations,
}, null, 2));

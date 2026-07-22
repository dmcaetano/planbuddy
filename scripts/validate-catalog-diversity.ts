import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { Candidate } from "../src/shared/types.js";
import type { GenerateContext } from "../src/server/ai/demoAi.js";
import { buildCatalogCandidate } from "../src/server/plans/engine/catalogPlanner.js";
import { buildDeterministicEdit } from "../src/server/plans/engine/pipeline.js";
import { fetchOverpassCatalog } from "../src/server/resolver/placeResolver.js";

const venues = await fetchOverpassCatalog(38.7223, -9.1393, 60);
assert(venues.length >= 1000, `Expected a broad Lisbon catalogue, received ${venues.length}`);
if (process.argv.includes("--write-bootstrap")) {
  const destination = path.resolve("src/server/resolver/data/lisbon-catalog.json");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(venues));
  process.stdout.write(`Wrote ${venues.length} venues to ${destination}\n`);
}

const scenarios = [
  "Walk a little, grilled fish or meat, and a soft stroll with my Pom. Meal: dinner. Walking: 45-75 minutes. Budget: flexible. Setting: mixed. Transport: flexible",
  "Relaxed family lunch with green space. Meal: lunch. Walking: 20-40 minutes. Budget: up to €25 per person. Setting: outdoors. Transport: car",
  "Art, architecture and a good meal. Meal: flexible. Walking: 45-75 minutes. Budget: up to €40 per person. Setting: indoors. Transport: public",
];
const recent: NonNullable<GenerateContext["recentSuggestions"]> = [];
const usedNames = new Set<string>();
let firstCandidate: ReturnType<typeof buildCatalogCandidate> = null;

for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const candidate = buildCatalogCandidate({
      scale: "weekend",
      homeBaseLabel: "Lisbon",
      homeBaseLat: 38.7223,
      homeBaseLng: -9.1393,
      participants: [{ name: "Pom", kind: "pet", relationship: "dog" }],
      moodContext: scenarios[scenarioIndex],
      radiusKm: 60,
      activeConstraints: [],
      loveTastes: [],
      avoidTastes: [],
      preferenceHunches: [],
      recentSuggestions: recent,
      seed: `acceptance:${scenarioIndex}:${iteration}`,
    }, venues);
    assert(candidate, `Scenario ${scenarioIndex + 1}, run ${iteration + 1} produced no plan`);
    firstCandidate ??= candidate;
    const names = candidate.beats.map((beat) => beat.place?.name).filter((name): name is string => Boolean(name));
    assert.equal(names.length, 3);
    for (const name of names) {
      assert(!usedNames.has(name.toLowerCase()), `Repeated place across surfaced plans: ${name}`);
      usedNames.add(name.toLowerCase());
    }
    recent.unshift({ title: candidate.title, category: candidate.category, placeNames: names });
    process.stdout.write(`Scenario ${scenarioIndex + 1}.${iteration + 1}: ${candidate.title}\n`);
  }
}

assert(firstCandidate);
const original = firstCandidate as unknown as Candidate;
const editCases = [
  ["restaurant", "Change only the restaurant"],
  ["meal_time", "Make it dinner"],
  ["budget", "Make it less expensive"],
  ["walking", "Less walking"],
  ["general", "More outdoors"],
] as const;
for (const [mode, request] of editCases) {
  const revised = buildDeterministicEdit({ request, mode, originalCandidate: original });
  assert(revised, `${mode} tweak produced no revision`);
  if (mode === "restaurant" || mode === "budget") {
    assert.equal(revised.beats[0].place?.name, original.beats[0].place?.name);
    assert.equal(revised.beats[2].place?.name, original.beats[2].place?.name);
    assert.notEqual(revised.beats[1].place?.name, original.beats[1].place?.name);
  } else {
    assert.deepEqual(revised.beats.map((beat) => beat.place?.name), original.beats.map((beat) => beat.place?.name));
  }
  process.stdout.write(`Tweak ${mode}: passed\n`);
}

process.stdout.write(`PASS: ${venues.length} places, 9 plans, ${usedNames.size} unique surfaced stops, 5 tweak modes.\n`);

/**
 * Benchmark for the fast plan-draft role (spec rule 26).
 * Sends N plan requests that actually reach the model (non-Lisbon cities and trips) and reports
 * schema-valid-and-quality-gate rate plus p50/p95 latency for the model in FAST_MODEL_ID.
 *
 *   FAST_MODEL_ID=deepseek/deepseek-v4-flash npx tsx scripts/benchmark-fast-model.ts [count]
 *
 * Reads the OpenRouter key from OPENROUTER_API_KEY or OPENROUTER_API_KEY_FILE (the shared key file).
 * Bar: >= 90% valid and p95 <= 12 s. Prints JSON; it never changes any setting.
 */
const count = Number(process.argv[2] ?? 20);

async function main() {
  const { callAiJson } = await import("../src/server/ai/deepseek.js");
  const { env } = await import("../src/server/env.js");
  const { aiGenerateResponseSchema } = await import("../src/shared/schemas.js");
  const { buildGenerateSystemPrompt, buildGenerateUserPrompt } = await import("../src/server/ai/prompts.js");
  const { quickPlanQualityIssue } = await import("../src/server/ai/index.js");

  const cities = [
    ["Porto, Portugal", 41.1496, -8.611],
    ["Madrid, Spain", 40.4168, -3.7038],
    ["Seville, Spain", 37.3891, -5.9845],
    ["Coimbra, Portugal", 40.2033, -8.4103],
    ["Lyon, France", 45.764, 4.8357],
  ] as const;
  const kinds = ["tonight", "day", "weekend"] as const;
  const latencies: number[] = [];
  const failures: string[] = [];
  let valid = 0;

  for (let i = 0; i < count; i += 1) {
    const [label, lat, lng] = cities[i % cities.length];
    const kind = kinds[i % kinds.length];
    const dinner = kind === "tonight";
    const ctx = {
      scale: kind === "weekend" ? ("weekend" as const) : ("day_off" as const),
      startDate: "2026-10-09",
      endDate: "2026-10-09",
      homeBaseLabel: label,
      homeBaseLat: lat,
      homeBaseLng: lng,
      participants: [{ name: "Diogo", kind: "person" as const, relationship: null }],
      moodContext: dinner ? "Meal: dinner. Walking: 45-75 minutes. Budget: flexible" : "Meal: lunch. Walking: 45-75 minutes. Budget: flexible",
      radiusKm: kind === "weekend" ? 60 : 25,
      activeConstraints: [],
      loveTastes: [{ id: "t1", text: "grilled fish and quiet gardens", source: "taste" as const }],
      avoidTastes: [],
      preferenceHunches: [],
      recentSuggestions: [],
      seed: `bench:${i}`,
    };
    const started = Date.now();
    try {
      const response = await callAiJson(buildGenerateSystemPrompt(ctx, true), buildGenerateUserPrompt(ctx, true), aiGenerateResponseSchema, { fast: true });
      const issue = quickPlanQualityIssue(response, ctx);
      if (issue) failures.push(`${label}/${kind}: ${issue}`);
      else valid += 1;
    } catch (err) {
      failures.push(`${label}/${kind}: ${String(err).slice(0, 120)}`);
    }
    latencies.push((Date.now() - started) / 1000);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  const result = {
    model: env.FAST_MODEL_ID,
    requests: count,
    validRate: Math.round((valid / count) * 1000) / 10,
    p50Seconds: Math.round(pct(0.5) * 10) / 10,
    p95Seconds: Math.round(pct(0.95) * 10) / 10,
    barMet: valid / count >= 0.9 && pct(0.95) <= 12,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
}

void main();

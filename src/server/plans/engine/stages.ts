// Stage keys reported by the generation pipeline as it progresses, and the
// human-facing metadata used to render them. Kept separate from both
// pipeline.ts and jobs.ts so neither module has to import the other just to
// share this vocabulary.

export const STAGE_ORDER = [
  "loading_memory",
  "fetching_weather",
  "grounding_places",
  "composing_plan",
  "validating_scoring",
  "enriching_saving",
] as const;

export type StageKey = (typeof STAGE_ORDER)[number];

export const STAGE_META: Record<StageKey, { label: string; pct: number }> = {
  loading_memory: { label: "Reading your household memory", pct: 10 },
  fetching_weather: { label: "Checking the weather", pct: 20 },
  grounding_places: { label: "Scouting real places nearby", pct: 35 },
  composing_plan: { label: "Composing your plan", pct: 55 },
  validating_scoring: { label: "Checking your constraints and scoring", pct: 80 },
  enriching_saving: { label: "Finishing touches", pct: 92 },
};

/** Invoked by the pipeline as it enters a new stage. May be async (persists to the job row). */
export type ProgressReporter = (stage: StageKey) => Promise<void> | void;

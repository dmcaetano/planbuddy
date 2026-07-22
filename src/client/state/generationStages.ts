/**
 * Ordered plan-generation stages, mirroring the server's plan-job pipeline exactly.
 * Keep this list in sync with the server contract (see PlanBuddy plan-jobs API).
 */
export interface GenerationStage {
  id: string;
  label: string;
  /** Approximate progress percentage once this stage is reached. */
  pct: number;
}

export const GENERATION_STAGES: GenerationStage[] = [
  { id: "loading_memory", label: "Reading your household memory", pct: 10 },
  { id: "fetching_weather", label: "Checking the weather", pct: 20 },
  { id: "grounding_places", label: "Scouting real places nearby", pct: 35 },
  { id: "composing_plan", label: "Composing your plan", pct: 55 },
  { id: "validating_scoring", label: "Checking your constraints and scoring", pct: 80 },
  { id: "enriching_saving", label: "Finishing touches", pct: 92 },
];

export function stageIndex(stageId?: string | null): number {
  if (!stageId) return -1;
  return GENERATION_STAGES.findIndex((stage) => stage.id === stageId);
}

/**
 * Expected wall-clock duration of each stage, used purely to drive the "living" progress bar
 * (see GenerationProgress). These are estimates, not contracts — the bar eases toward a cap
 * over this duration but always snaps to the real stage/floor the moment the server reports a
 * stage change, so a wrong estimate only affects how eagerly the bar creeps, never its honesty.
 */
const STAGE_EXPECTED_DURATION_MS: Record<string, number> = {
  composing_plan: 45000,
};
export const DEFAULT_STAGE_DURATION_MS = 15000;

export function expectedStageDurationMs(stageId?: string | null): number {
  if (!stageId) return DEFAULT_STAGE_DURATION_MS;
  return STAGE_EXPECTED_DURATION_MS[stageId] ?? DEFAULT_STAGE_DURATION_MS;
}

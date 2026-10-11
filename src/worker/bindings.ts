import type { PlanGenerationParams } from "./workflows/planGeneration.js";

export interface WorkerBindings {
  PLAN_GENERATION: {
    create(options: { id?: string; params: PlanGenerationParams }): Promise<unknown>;
  };
}

// Re-exports the canonical, Express-free view helpers (now in
// src/server/plans/pipelineResponse.ts, extracted from plans/routes.ts
// during this port so moment/routes.ts and this Worker could both reach
// them without importing an Express Router module). Kept as a thin
// re-export (rather than importing pipelineResponse.js directly in
// planSpecs.routes.ts / workflows/planGeneration.ts) so a future rename
// only touches one place on the Worker side.
export { planView, candidateGroundingSources, pipelineResponse } from "../server/plans/pipelineResponse.js";

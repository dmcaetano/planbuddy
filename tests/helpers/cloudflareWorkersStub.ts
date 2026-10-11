// Stub for the `cloudflare:workers` built-in module, which only exists
// inside the real Workers runtime. Plain-Node vitest tests import
// src/worker/index.ts (to get its Hono `app.fetch` export), which in turn
// imports src/worker/workflows/planGeneration.ts (to re-export the
// PlanGenerationWorkflow class for wrangler's binding) — this satisfies
// that import so the module graph loads under Node. The Workflow's `run()`
// method itself is never invoked from plain-Node tests (it needs a real
// `step.do()`), so this stub's behavior is irrelevant beyond "importable".
export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  env!: Env;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run(_event: unknown, _step: unknown): Promise<unknown> {
    throw new Error("WorkflowEntrypoint.run() stub: not runnable outside the real Workers runtime");
  }
}

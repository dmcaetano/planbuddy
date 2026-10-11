# PlanBuddy -> Cloudflare Worker (Workers Free plan) — port plan

Goal: replace the Render Node/Express long-lived process with ONE Cloudflare Worker
(`planbuddy`) serving the Vite SPA via `[assets]` plus `/api/*` and `/healthz`, on the
Workers Free plan (10ms CPU/invocation excl. I/O wait, 50 subrequests/invocation,
waitUntil ~30s, Workflows/Cron Triggers/Durable Objects available free). Same Neon DB,
no data migration. Render app stays up and 302s browser navigations to the Worker after
cutover (does not get deleted/suspended).

## Module map -> target

| Source | LOC | Target |
|---|---|---|
| src/server/app.ts (Express app, middleware, CORS, cookies) | - | Hono app, same middleware semantics |
| src/server/index.ts (listen, 2x setInterval, startup warm-up) | - | removed; crons via `[triggers]`; warm-up becomes lazy (module-scope cache on first use) |
| src/server/db/client.ts (`pg.Pool` + PGlite fallback) | - | `@neondatabase/serverless`: `neon()` HTTP for single queries, `Pool` (ws) only where a real transaction is needed. Same schema/search_path pattern. PGlite fallback dropped (dev-only; Worker dev uses real Neon branch or wrangler's pg proxy). |
| src/server/auth/routes.ts | - | Hono router, same paths/cookies/status codes. bcryptjs stays (pure JS, nodejs_compat) — no native bcrypt in deps today, so no bcrypt swap needed (already JS). |
| participants, constraints, tastes (memory/*), hunches, weather, plan-specs/plans, plan-chat, history, chat, friends, shares, timeoff, moment | - | Hono routers 1:1, phase 3 |
| plans/jobs.ts (`void runDetached`, DB-row progress) + plans/engine (4.5k) + ai (1.9k, tool-calling agent, 90s timeout, Overpass) | 6.4k | Cloudflare Workflow `PLAN_JOBS`: POST creates DB row + `env.PLAN_JOBS.create()`; each model call / tool round / Overpass call = its own `step.do()`. Same DB-row progress contract so the client's existing polling needs no change. |
| chat retention sweep (6h) + interrupted-job recovery sweep (5min) | - | `[triggers] crons` two schedules; recovery sweep now also re-creates/marks Workflow instances instead of nudging an in-process timer |
| src/server/omni/* (Buddy Contract: HMAC, AES-256-GCM link secrets, omni_seen replay, per-IP throttle, undo tokens) | 1.2k | ported LAST (phase 6). HMAC/AES via Web Crypto (pattern proven byte-identical to node:crypto in UnGlutened's functions port). Replay/throttle already DB-backed (omni_seen, omni_bad_sig tables) — no in-memory maps to move. |

No Node-only blockers found besides the process-level `setInterval`s and the `pg.Pool`
TCP driver — both have direct Workers equivalents above. bcryptjs is pure-JS already
(argon2 is only an *optional* dep, not required at runtime).

## Risks

1. **Workflow step granularity for the AI agent loop** — routeAgent.ts's tool-calling loop
   (up to AI_AGENT_MAX_STEPS=10, 90s budget) must become N `step.do()` calls; must confirm
   each individual model/tool call fits under 10ms CPU (I/O wait — the actual LLM round
   trip — does not count against it, so this should hold, but needs live measurement in
   phase 4, not assumed).
2. **Neon driver swap correctness** — `Pool`-based transactions (job state transitions,
   omni_seen atomic claim) must keep the same atomicity under the WebSocket driver; verify
   with the existing concurrency-sensitive tests (replay claim, per-IP counter).
3. **Cookie/session behavior parity** under Hono vs Express — auth cookie flags (httpOnly,
   sameSite, secure) must match exactly or existing logged-in sessions break on cutover.
4. **Buddy Contract crypto parity** — AES-256-GCM link-secret sealing and HMAC signing must
   be byte-identical to the Node implementation so already-issued OmniBuddy links keep
   validating against the same stored secrets (no secret rotation on cutover).
5. **Workers Free subrequest cap (50/invocation)** — Overpass + place-resolver calls inside
   one plan-generation Workflow instance must be counted; if a single step issues many
   subrequests it needs splitting across steps (each `step.do()` likely gets its own
   budget — confirm against current Workflows docs in phase 4, don't assume).
6. **Cutover correctness** — Render's 302-to-Worker redirect must only catch browser
   navigations (`Accept: text/html`), never `/api/*` or `/healthz`, or the Worker/Render
   split breaks for in-flight sessions during rollout.

## Phases (this plan covers phase 1; 2-8 per the job spec)

1. (this file) Read docs/server, module map, risks, branch `cloudflare-worker`. DONE.
2. Worker skeleton + assets + Neon HTTP driver + /healthz + auth routes; deploy to
   `planbuddy.<account>.workers.dev`; verify login against the real DB.
3. Remaining CRUD/read route modules.
4. Plan-generation Workflow + polling; one real end-to-end plan generation on the deployed
   Worker with a disposable test account (delete its data after).
5. Crons (chat retention 6h, interrupted-job recovery 5min).
6. Buddy Contract (health/connect/card/context/act/suggest/undo) — same signing/secret
   format so existing OmniBuddy-made links keep working.
7. Tests: adapt existing Vitest harness to the Workers runtime where needed, add Worker
   handler tests, run Playwright e2e against the Worker URL.
8. Cutover: merge to main, Render 302s html navigations to the Worker URL (keep Render
   service running, just redirecting), version bump, STATE/LOG/DESCRIPTION updates, push.

# Plan: Max 1-click life (file-level)
Derived from: spec.md (reviewed PASS WITH NOTES, commit 50711bb) · Claude's working document; keep it true.
Contract types: `src/shared/momentTypes.ts` (written first; every workstream codes against it).

## Design decisions that bind the build
- **Moment engine is pure and shared**: `src/shared/moment.ts` (`resolveMoment(localIso)`, `momentTimes()`,
  scope-switch dates, labels, partner-word list). Unit-tested against spec Acceptance 1 and 2.
- **Plan-spec columns** (migration 0011): `moment_kind`, `moment_key`, `plan_date`, `inputs_fingerprint`,
  `reason_parts JSONB`. `life_dates` and `trip_ideas` tables, both `user_id`-scoped.
- **Reuse** = the newest *plan row* whose spec has the same key + fingerprint; reused only if its status is not
  `rejected`. Show another creates a newer suggested row under the same spec (existing regenerate route).
- **Locked covers the moment** = a locked plan whose spec date range overlaps `planDate` (and, for a same-day
  plan, whose last beat has not ended); trips compare dates only.
- **Retime in place** = child spec (parent_spec_id, version+1, same key/fingerprint, same generation_count) +
  ONE new candidate with retimed beats (same venues) and the existing suggested plan row is repointed to it
  (`UPDATE plans SET candidate_id, beats`), so no new History row; the old candidate stays reachable as the
  "other version" the client already knows how to show. No new plan row, no generation counted.
- **Opening never starts a job when it can reuse**; the endpoint returns `status:"generating"` + `jobId` only for a
  new key/fingerprint or an unmeetable meal window. The client tracks the job (new `JobKind` "moment") and calls
  the endpoint again when it succeeds (the stored spec carries the reason parts, so the line is identical).
- **Household group** = all local participants of the owner (owner, people, pets); never friend accounts.
- **Reason line is assembled by the server** from `ReasonParts`; taste = the catalogue planner's reported match
  (new `buildCatalogCandidateWithMatch`), model path = deterministic token overlap, else omitted.
- **Meal-first**: `GenerateContext.moment` (kind, startTime, mealFirst, mealStart, romantic) drives
  catalogPlanner beat order/times, the model prompt hint, `quickPlanQualityIssue` (meal index from ctx, default 1)
  and the retime function. Default behaviour with no `moment` is byte-identical to today (162 tests stay green).
- **Trip ideas** are cached text in `trip_ideas` (DeepSeek, MODEL_ID, schema-validated, no price/flight claims,
  farther idea not in last 100 surfaced plans' destinations); never a plan row, never the job slot.
- **No new provider/key.** Fast-role switch is benchmark-gated (workstream F).

## Workstreams, files, owners
All implementation by Sonnet agents with explicit model; I orchestrate, review diffs, run QA, commit.

### A. Server moment engine (Increment 1)  — owner: sonnet-A
- NEW `src/shared/moment.ts`, `tests/unit/moment.test.ts` (Acceptance 1, 2 incl. every-minute-of-a-week test).
- NEW `src/server/db/migrations/0011_moment_and_time_off.sql` (columns + `life_dates` + `trip_ideas`); keep
  PGlite + Neon compatible (no pgcrypto), idempotent `IF NOT EXISTS`.
- `src/server/plans/specs.repo.ts`: createPlanSpec accepts moment fields; read them back; `PlanSpec` type in
  `src/shared/types.ts` gains optional `momentKind, momentKey, planDate, inputsFingerprint`.
- NEW `src/server/moment/{fingerprint,romantic,reason,repo,retime,routes}.ts`; mount `/api/moment` in `app.ts`
  (rate-limited like other model endpoints; validates `localDateTime` strictly, year 2020–2100).
- `src/server/ai/demoAi.ts` (GenerateContext.moment), `src/server/plans/engine/catalogPlanner.ts`
  (moment timing, meal-first order, `buildCatalogCandidateWithMatch`), `src/server/ai/index.ts`
  (`quickPlanQualityIssue` meal index), `src/server/ai/prompts.ts` (moment hint),
  `src/server/plans/engine/pipeline.ts` (pass moment into genCtx; persist reason parts on the spec; weather clause).
- Tests: `tests/integration/moment.test.ts` (Acceptance 3, 4, 5, 6, 7, 8 server side), unit tests for fingerprint,
  romantic, reason, retime; meal-first tests for catalogPlanner/quality gate.

### B. Relationship data + Buddy actions — owner: sonnet-B (parallel with A; disjoint files)
- `src/client/routes/OnboardingPage.tsx`, `src/client/routes/MemoryPage.tsx`: set/edit/clear relationship on each
  local person (reuse `PATCH /participants/:id`; confirm it accepts `relationship: null`).
- `src/server/chat/routes.ts`, `src/server/ai/prompts.ts` chat section, `src/client/components/BuddyDock.tsx`:
  deterministic "<Name> is my <relationship>" path + model path; propose → confirm chip → save; unknown name →
  offer to add. (Time-off Buddy action is added in workstream D, same files, after B merges.)
- Server tests for the participant update + Buddy proposal route; component-level tests where the repo has a
  pattern (`tests/`), otherwise covered by the Playwright pass.

### C. Home screen + routes + PlanBrowser extraction + e2e — owner: sonnet-C (after A's contract compiles)
- NEW `src/client/components/PlanBrowser.tsx`: extracted from `PlanPage.tsx` browsing/locked/dead-end views
  (all of lines ~190–540: queue, lock, show another, not this, tweak, Buddy editor, version banner, job-fold
  for `regenerate`/`edit`); props `{ initial, participants, onStartOver, header? }`. `PlanPage.tsx` shrinks to
  the setup form + `<PlanBrowser>`; behaviour identical.
- NEW `src/client/routes/HomePage.tsx` + `src/client/styles/home.css`: calls `POST /api/moment` with the device
  local `YYYY-MM-DDTHH:mm:ss` (browser clock, so Playwright's controlled clock works), skeleton with
  moment-specific text, reason line, scope switch chips (Tonight / A day out / This weekend / Trip) + Customize,
  `PlanBrowser` below, nudge card (Increment 2 slot, renders when `nudge` present, lead ordering per `lead`).
  Registers the plan with `PlanFocusContext`. `aria-live` loading, reduced-motion skeleton.
- `src/client/App.tsx`: `/` = Home, `/plan/custom` = PlanPage, `/plan` and `*` redirect to `/`;
  `src/client/components/NavBar.tsx` Plan tab → `/`; `GenerationContext` gains `JobKind "moment"` and PlanPage's
  fold ignores it; Customize action passes group + kind via router state.
- Rewrite `e2e/happy-path.spec.ts` to enter via `/plan/custom`; Buddy edit + share run from Home.

### D. Time off + trip nudge (Increment 2) — owner: sonnet-D (after A, B, C merged)
- NEW `src/server/timeoff/{repo,routes,nudge,tripIdeas}.ts` (`/api/time-off` CRUD + snooze/unsnooze, 404 cross-tenant),
  `src/shared/schemas.ts` additions, nudge computation inside the moment route (`lead`, precedence rule 22),
  season guard (rule 21), 14-day / range-edit invalidation of `trip_ideas`, "Other ideas" endpoint.
- Client: Memory "Time off" section (CRUD, delete confirm, Show again), `TripNudgeCard` on Home, idea tap →
  `generation.startSpec` (getaway/vacation scale, range dates, `moodContext: "Trip idea: <name>"`).
- Buddy `add_time_off` confirm chip.
- Tests: Acceptance 10, 11, 12 (clock-advanced snooze test), tenant isolation.

### E. Verification (me) — qa-protocol + visual-verify
- Full local gate: `npm run typecheck`, `lint`, `test`, `build`, `test:e2e`.
- Local real-build run with controlled browser clock at Fri 19:00 / Sat 11:00 / Wed 14:00; screenshots at 390 px.

### F. Model bar (me, after the build is green)
- NEW `scripts/benchmark-fast-model.ts`: ≥20 (target 40) requests reaching the model (non-Lisbon + trips +
  forced catalogue-miss), measuring schema-valid-and-quality-gate rate and p95. If ≥90% and p95 ≤12 s change
  `FAST_MODEL_ID` default in `src/server/env.ts` and `render.yaml` together; else keep and report the numbers.
  Needs `OPENROUTER_API_KEY` from `API Keys\` (ask nothing: key file already exists on this machine).

### G. Ship
- Version bump to **v1.2.0 "Batman"** (package.json, `PlanPage` pill moved to Home/Customize pill — find all
  hard-coded version strings with grep), DESCRIPTION.md/html, STATE.md, LOG.md; commit; push `origin main`;
  Render deploy (auto from main — verify the deploy id/state via the Render API/dashboard creds in `API Keys\`);
  warm the service; live canary (account `canary+…` created by me, household owner + wife + dog + a few tastes,
  credentials only under `API Keys\`); controlled clock at Fri 19:00 / Sat 11:00 / Wed 14:00; 390 px screenshots
  inspected; timings: reused < 1 s, fresh Lisbon < 5 s.

## Order and gates
1. A and B in parallel → typecheck + existing 162 tests green → commit each.
2. C → full gate + e2e → commit.
3. D → full gate → commit.
4. E, F → fix → commit. 5. G.
Each workstream ends with: typecheck, lint, `npm test` green, then I review the diff before committing.

## Known traps (from the repo read)
- `insertPlan` is keyed by `candidate_id` (updates an existing row for the same candidate) — retime repoints, never inserts.
- One active job per user (migration 0008): trip ideas must not use `enqueueGenerationJob`.
- `JobStatus`/job result is the PipelineResponse; the moment endpoint must not change that contract.
- `catalogPlanner` seeds on `${spec.id}:${batchIndex}`; reuse of a Lisbon plan must never re-run it.
- Friend accounts: `friends/repo.ts:76` forces relationship "PlanBuddy friend"; Home groups exclude friends entirely.
- `package.json` is 1.1.6 while STATE says 1.1.4: reconcile at the bump (grep for `v1.1.4`).

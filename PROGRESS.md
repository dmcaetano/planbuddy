## Goal
PlanBuddy is a mobile-first Buddy-family web app that gives one confident, personalized plan for a day off, weekend, getaway, or vacation. It learns safely from explicit feedback and chat, remembers household members and pets, treats allergies and other hard constraints as inviolable, exposes every durable memory for review, and runs as an authenticated Render app backed by Neon Postgres with DeepSeek V4 Flash server-side.

## Roadmap

### Phase 1 — Foundation
- [x] Scaffold React/Vite/TypeScript client and Express/TypeScript server
- [x] Add normalized Neon schema and migrations (+ zero-setup local PGlite fallback)
- [x] Add email/password authentication and secure cookie sessions
- [x] Establish warm daylight-editorial design system and responsive shell

### Phase 2 — Trusted memory
- [x] Household and participant onboarding (people + pets)
- [x] Full CRUD for constraints, tastes, and hunches
- [x] Mechanical quote verification for chat-extracted facts (quote-or-demote)
- [x] Hunch decay, evidence, confirmation, dismissal, and taste promotion

### Phase 3 — Planning loop
- [x] Plan specs for Day off, Weekend, Getaway, and Vacation
- [x] Weather context and pluggable live-place resolver (Inspiration mode by default)
- [x] DeepSeek structured candidate generation with schema validation + one repair attempt
- [x] Deterministic constraint filter, least-misery scoring, novelty, and diverse alternates
- [x] Lock, show-another (one regeneration batch), not-this, tweak, and honest failure/looseners states

### Phase 4 — Chat and feedback
- [x] Top-level DeepSeek chat tied to bounded planning sessions (message cap, retention sweep)
- [x] Structured memory capture with visible provenance
- [x] History with upcoming/past plans
- [x] Post-plan feedback and self-improvement loop (feedback -> hunch evidence -> promotion)

### Phase 5 — Ship quality
- [x] Unit, contract, integration, and Playwright tests (59 Vitest + 1 Playwright, all green)
- [x] Visual verification via Playwright (mobile viewport) and manual smoke testing
- [x] Security/privacy pass (see below)
- [ ] Render deployment with persistent Neon database — **not performed this session** (local build only, per instructions: do not push or deploy)
- [ ] Live generation/chat canary verification against the real DeepSeek API — **not performed**; no `OPENROUTER_API_KEY` was available in this environment. The deterministic demo AI stands in and is fully exercised by tests; the real OpenRouter client (`src/server/ai/deepseek.ts`) is implemented and schema-validated but unexercised against a live endpoint.
- [x] DESCRIPTION.md and DESCRIPTION.html

## Current state

**The local MVP is complete and build-verified on branch `build-mvp`.** A fresh
user can sign up, onboard a home base and participants (including pets),
generate a plan for any of the four scales, have a typed or chat-quoted hard
constraint mechanically enforced (peanut-allergy filtering demonstrated in
both unit and integration tests), browse alternates without touching memory,
reject with a reason, lock a plan, find it in History, leave feedback that
creates an inspectable hunch, and see everything in Memory with provenance
and full CRUD. All four tabs (Plan/Chat/Memory/History) work end-to-end.

Verified green in this session:
- `npm run typecheck` — client + server, strict TypeScript, zero errors.
- `npm run lint` — ESLint, zero errors/warnings.
- `npm run build` — Vite client build + tsc server build + migration asset copy.
- `npm test` — 59 Vitest tests (unit engine tests, AI-contract/schema tests, Supertest integration tests against an in-memory PGlite DB), stable across repeated runs.
- `npm run test:e2e` — Playwright happy path (signup → onboard → generate → reject → lock → feedback → Memory) against the production build, in a mobile viewport.
- Manual smoke testing of the running server confirmed the peanut-allergy constraint filter, session cookies, chat quote-or-demote, and feedback → hunch pipeline all work over real HTTP.

One real bug was found and fixed during this build: the server's static
file path pointed at `dist-server/client` instead of the actual Vite output
directory `dist/client`, which would have 404'd the entire client in a
production/Playwright run — caught by running the E2E test against the real
build rather than only `npm run dev`. A second bug (History misclassifying
future-dated locked plans as "past") was caused by node-postgres parsing
`DATE` columns into JS `Date` objects rather than strings; fixed with a
`toDateOnlyString` normalization helper (`src/server/db/dateUtil.ts`) and
covered implicitly by the plan.test.ts lock→history assertion.

### Known gaps / what's next for a human or Codex reviewer
1. **Live DeepSeek canary** — set `OPENROUTER_API_KEY` and re-run a manual generate + chat message to validate the real OpenRouter contract; the demo AI path is fully tested but the network path is not.
2. **Render + Neon deployment** — not attempted this session (explicitly out of scope: "do not push or deploy"). `DATABASE_URL` support and the migration runner are implemented and would need a live Neon connection string to validate against real Postgres (only PGlite has been exercised).
3. **Live place resolver** — no provider is wired up; the app runs in Inspiration mode. The interface (`src/server/resolver/placeResolver.ts`) is ready for a real provider.
4. **Lighthouse** — not run (no live deployed URL to point it at in this session).
5. Playwright coverage is currently one broad happy-path scenario; a reviewer may want to add scenarios for dead-end/looseners, getaway/vacation trip beats, and hunch promotion-after-three-evidence-events.

## Next steps
1. Provide `OPENROUTER_API_KEY` and run a live DeepSeek generate + chat canary.
2. Provision Neon Postgres, set `DATABASE_URL`, run `npm run migrate`, and deploy to Render.
3. Wire a real place-resolver provider if venue-level facts are desired.
4. Run Lighthouse and a full accessibility pass against the deployed URL.
5. Expand Playwright coverage per the gaps above.

## Log

### 2026-07-19 — Product contract frozen
Completed three independent Codex–Fable product rounds. Settled one-pick doctrine, four planning modes, participant-aware least-misery scoring, visible three-tier memory, immediate protection from quoted constraints, venue firewall, deterministic ranking, top-level chat, feedback-driven learning, and the Render/Neon/DeepSeek stack. Created the PlanBuddy workspace and tracking files.

### 2026-07-19 — Local MVP implemented end-to-end
Built the complete single-package React/Vite/TypeScript + Express/TypeScript
application on branch `build-mvp`: normalized Postgres schema with a
zero-setup embedded PGlite fallback; email/password auth with signed
httpOnly cookies and Argon2id/bcrypt hashing; participants including pets;
full CRUD for constraints/tastes/hunches with mechanical quote-or-demote
verification; a deterministic constraint-filter/least-misery-scoring/
novelty/alternates recommendation engine sitting on a pluggable DeepSeek V4
Flash client with a deterministic offline demo AI fallback; bounded chat
sessions with 30-day raw-transcript retention; History and feedback-driven
hunch learning; the daylight-editorial design system implemented directly
in CSS (no raster assets); and a full test suite (Vitest unit/contract/
integration + Playwright E2E) — all green. Found and fixed two real bugs
(client static-path mismatch; Date-object vs. string comparison in History)
via end-to-end verification rather than trusting unit tests alone. Did not
push, deploy, or exercise the live DeepSeek/Neon paths, per instructions.

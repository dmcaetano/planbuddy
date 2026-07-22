## Goal
PlanBuddy is a mobile-first Buddy-family web app that gives one confident, personalized plan for a day off, weekend, getaway, or vacation. It learns safely from explicit feedback and chat, remembers household members and pets, treats allergies and other hard constraints as inviolable, exposes every durable memory for review, and runs as an authenticated Render app backed by Neon Postgres with DeepSeek V4 Flash server-side.

## Roadmap

### v1.1.3 catalogue diversity release
- [x] Replace the three-route Lisbon shortcut with a 60 km OpenStreetMap catalogue
- [x] Persist the catalogue in Neon and refresh it asynchronously with mirror failover
- [x] Bundle the verified 11,185-place snapshot so Render cold starts are instant
- [x] Exclude named stops from the last 100 surfaced plans
- [x] Compose compact three-stop routes with real distances and Maps enrichment
- [x] Add radius, meal, walking, budget, setting, and transport controls
- [x] Add visible Start over and immediate route-preserving tweak modes
- [x] Add learned-hunch edit and permanent delete
- [x] Pass 9-plan/27-unique-stop real-data acceptance and 159 automated tests
- [ ] Deploy and complete the live production canary

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
- [x] Live Open-Meteo context and Gemini Search place grounding with source firewall
- [x] DeepSeek structured candidate generation with schema validation + one repair attempt
- [x] Deterministic constraint filter, least-misery scoring, novelty, and diverse alternates
- [x] Lock, show-another (one regeneration batch), not-this, tweak, and honest failure/looseners states

### Phase 4 — Chat and feedback
- [x] Top-level DeepSeek chat tied to bounded planning sessions (message cap, retention sweep)
- [x] Structured memory capture with visible provenance
- [x] History with automatically saved suggestions, upcoming plans, and past/disliked plans
- [x] Post-plan feedback and self-improvement loop (feedback -> hunch evidence -> promotion)
- [x] Like/Dislike/Love on suggestions and History; Love extracts reusable venue-agnostic features
- [x] Persistent plan-scoped Buddy that runs all plan actions and makes reversible surgical edits
- [x] Friend invites, mutual connections, explicit group selection, and private cross-account fit
- [x] Immutable privacy-safe itinerary sharing with native share/clipboard support

### Phase 5 — Ship quality
- [x] Unit, contract, integration, and Playwright tests (89 Vitest + 1 Playwright, all green)
- [x] Visual verification via Playwright (mobile viewport) and manual smoke testing
- [x] Security/privacy pass (see below)
- [x] Render deployment with a dedicated persistent Neon database: https://planbuddy.onrender.com
- [x] Live grounded recommendation canary via Gemini Search plus DeepSeek chat/feedback
- [x] DESCRIPTION.md and DESCRIPTION.html

### Phase 6 — v1.0 alpha release (2026-07-20)
- [x] Async plan generation: job table, 202+jobId, stage-by-stage progress, idempotency, interrupted-job sweep, DB-enforced one-active-job-per-user
- [x] Client generation state survives tab switches and reloads (GenerationProvider above routes, visibility-aware polling, reattach, cross-tab banner incl. failure state)
- [x] Optional 10-question taste-profile quiz (onboarding + retakeable from Memory, server-side answer catalog, verified allergy constraints)
- [x] Social v1: reversible block, friend labels/circles (Family, Close friends, custom), one-tap circle chips + "Last group" in plan creation
- [x] Visual polish: skeletons, shared form classes, empty states, logout account row
- [x] Provider resilience: fast Gemini failover, DeepSeek reasoning-starvation fix (28k max_tokens + 8k reasoning cap + direct-answer retry), citation robustness, sanitized errors
- [x] Adversarial review (GPT-5.6 sol, with executed repros) + live production QA canaries; all confirmed findings fixed
- [ ] PlanPage circle-chip UX feedback from alpha testers

## Current state

**Version 1.1.2 "Wasp" is live on Render from `main` (`92f0d73`).** One-click planning now
uses one bounded structured-model call instead of sequential place research and
composition. A 12-second provider deadline falls back to a concrete, rotating,
Maps-ready Lisbon plan; optional memory citations can be stripped but can never
veto an otherwise safe plan. Lisbon home plans use a trusted local route pack
matched to memory and History before any network model. TypeScript, lint,
production build, mobile Playwright, and 148 Vitest tests are green. The exact
Lisbon/Pom/gluten production canary returned its complete plan in 1.5 seconds.

**Version 1.0.1 "Iron Man" is live on Render from `main` and backed by the dedicated Neon project.** Shipped 2026-07-20: v1.0.0 (`111dc4e`, features) + v1.0.1 (`612653a`, hardening). 128 Vitest tests + Playwright E2E green; two live production canaries run. Previous baseline (v0.1.5): A fresh
user can sign up, onboard a home base and participants (including pets),
generate a plan for any of the four scales, have a typed or chat-quoted hard
constraint mechanically enforced (peanut-allergy filtering demonstrated in
both unit and integration tests), browse alternates without touching memory,
reject with a reason, lock a plan, find it in History, leave feedback that
creates an inspectable hunch, and see everything in Memory with provenance
and full CRUD. Users can connect friends, explicitly include them in a plan,
share a scrubbed itinerary, teach the system with Love, and ask Buddy to change
one venue, meal time, budget, or walking detail without losing the original.
Every surfaced suggestion is recorded before selection, can be reopened and
rated or locked later, and contributes title/category/venue exclusions to the
anti-repeat loop. All four primary tabs plus Friends, invite, and public-share
routes work end-to-end.

Verified green in this session:
- `npm run typecheck` — client + server, strict TypeScript, zero errors.
- `npm run lint` — ESLint, zero errors/warnings.
- `npm run build` — Vite client build + tsc server build + migration asset copy.
- `npm test` — 89 Vitest tests across 15 files, including suggestion-history, venue-novelty, social privacy, and surgical-edit regression coverage.
- `npm run test:e2e` — Playwright mobile journey: signup → generate → Love → Buddy restaurant edit → share → dislike → lock → feedback → Memory.
- A strict production canary confirmed a real Gemini-grounded three-stop Lisbon
  route with Google Maps links, an attributed photo, 60 reconciled walking
  minutes, clothing and Pom preparation, operational checks, lock, feedback →
  hunch learning, and Neon persistence.
- A second production canary repeated the same grilled-fish-and-walk request:
  the first route used Alfama and the second used Cacilhas, with zero named-place
  overlap. The first appeared in Saved suggestions before being locked, then
  moved to Upcoming without creating a duplicate.

One real bug was found and fixed during this build: the server's static
file path pointed at `dist-server/client` instead of the actual Vite output
directory `dist/client`, which would have 404'd the entire client in a
production/Playwright run — caught by running the E2E test against the real
build rather than only `npm run dev`. A second bug (History misclassifying
future-dated locked plans as "past") was caused by node-postgres parsing
`DATE` columns into JS `Date` objects rather than strings; fixed with a
`toDateOnlyString` normalization helper (`src/server/db/dateUtil.ts`) and
covered implicitly by the plan.test.ts lock→history assertion.

### Known gaps / what's next
1. **Operational venue truth** — named places are grounded, but hours, booking,
   current prices, accessibility, and pet policy remain explicit checks until a
   transactional place/booking API is added.
2. **Calendar/booking integrations** — intentionally deferred until the one-pick and learning loop has real usage evidence.
3. **Broader browser coverage** — add separate Playwright scenarios for dead ends, trip modes, friend acceptance, and hunch promotion.

## Next steps
1. Hand the fast one-click planner to alpha testers.
2. Expand the trusted city-pack approach beyond Lisbon using real usage demand.

1. Hand v1.0.1 to alpha testers; collect feedback on recommendation quality, quiz usefulness, and circle selection.
2. Watch Render logs for provider-failover behavior under real Gemini outages (reasoning-starvation retry, fallback success rate).
3. Add a transactional place/booking provider for current operational facts.
4. Add calendar conflict awareness and broader Playwright coverage (dead ends, trip modes, friend acceptance, hunch promotion).

## Log

### 2026-07-22 — v1.1.1 one-click planner recovery
Production logs showed that one plan took 149 seconds: about 90 seconds for a
DeepSeek web-search dossier and 54 seconds for composition after two permanent
Gemini location failures. The resulting safe candidate was then rejected only
because an optional memory citation could not be verified. Replaced that chain
with one fast structured plan call, a hard 12-second deadline, and a concrete
Maps-ready Lisbon fallback that rotates away from History. Invalid optional
citations are now stripped rather than treated as safety vetoes; weather and
photo enrichment have short best-effort timeouts. Live model canary: 8.8 seconds
for a personalized plan. A deterministic quality gate rejects repeated stops,
Lisbon lake framing, and generic food halls when a restaurant was requested.
Full suite: 147/147 Vitest tests, mobile Playwright, and production build.
The first v1.1.1 production canary was fast (9.6 seconds) but still chose Time
Out Market. v1.1.2 therefore routes Lisbon directly through the trusted,
memory-aware local pack; its planner step benchmarks at 1 ms and still rotates
away from History. Render deploy `dep-d9gki5vaqgkc73d0vafg` is live. The exact
request produced Jardim da Estrela → Peixaria da Esquina → Jardim Teófilo de
Braga in 1.5 seconds with Maps, route, cost, clothing, Pom/diet checks, and a
History save. Repeating it rotated to Necessidades → Último Porto → Doca de
Santo Amaro with zero venue overlap.

### 2026-07-20 — v1.0.0 "Iron Man" + v1.0.1 hardening (alpha release)
Avengers-assemble campaign (Fable chair, Sonnet builders, Haiku scouts, GPT-5.6
sol cross-vendor). v1.0.0: plan generation became an async job with live named
stages and a progress UI that survives tab switches and reloads (the "user
stands there thinking it's broken" complaint); optional 10-question taste
quiz writing visible tastes and verified allergy constraints; social v1
(reversible block, Family/Close-friends/custom circles, one-tap circle chips,
"Last group"); visual polish pass. v1.0.1: fixed everything sol's adversarial
review repro'd (job-uniqueness race, failed→succeeded resurrection, stale-plan
resurrection after Buddy edits, post-logout polling, blocked friends leaking
into circles, block/accept race, quiz row amplification) plus live-QA findings
(silent failure banner, missing logout) and the production provider incident:
Gemini 503 storms exposed DeepSeek reasoning starvation (24.5k reasoning
tokens, zero content) — fixed with token headroom, reasoning caps, a
direct-answer retry, and fast Gemini failover. E2E caught a real state-loss
bug (fold+dismiss) before ship; live canary caught the rest. 128 tests green.

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

### 2026-07-19 — Production release
Merged the reviewed MVP to `main`, published it at
https://github.com/dmcaetano/planbuddy, provisioned dedicated Neon project
`aged-dream-11028120` in `aws-eu-central-1`, and deployed Render service
`srv-d9eclkf41pts73emgdcg` in Frankfurt. The final production canary passed
real DeepSeek recommendation/chat, constraint-safe filtering, feedback
learning, and fresh-login persistence at https://planbuddy.onrender.com.

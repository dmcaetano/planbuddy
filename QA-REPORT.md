# PlanBuddy QA report

Version **0.1.0 — “Field Guide”**  
Reviewed 2026-07-19 by Codex after the Claude/Fable/Sonnet build handoff.

## 1. Feature inventory

- Email/password signup, login, signed server-side sessions, logout, and rate limits.
- Two-step onboarding with geocoded home base plus household people and pets.
- One-click planning across Day off, Weekend, Getaway, and Vacation.
- Eight AI candidates per batch, server-side hard filtering, deterministic
  least-misery scoring, one winner, and safe diverse alternates.
- Open-Meteo context and explicit Inspiration mode when no live venue resolver
  is configured.
- Plan, Chat, Memory, and History surfaces.
- Visible CRUD memory for constraints and tastes; weak, decaying, inspectable
  hunches; quote-or-demote chat extraction.
- Lock, neutral Show another, reasoned Not this, history, comments, star ratings,
  and thumbs-style feedback feeding the learning loop.
- PGlite zero-setup local persistence and isolated Neon/Postgres persistence.

## 2. Verification procedures

- Strict TypeScript client and server type-check.
- ESLint across all TypeScript and React sources.
- Production Vite and Node server build, including copied SQL migrations.
- Unit tests for filters, citations, quote verification, group scoring, novelty,
  hunch caps, and venue firewall behavior.
- Contract tests against the complete local AI response pool.
- Supertest integration tests for auth, tenant isolation, memory, generation,
  rejected-candidate locking, travel-mode structure, history, and feedback.
- Playwright mobile-Chrome journey: signup → onboarding → generation → rejection
  → alternate → lock → feedback → chat extraction → visible Memory.
- Manual Playwright CLI review at 1440×1000 and 390×844, with screenshots in
  `output/playwright/` (kept local, not committed).
- `npm audit` for the full dependency tree and for production dependencies.

## 3. Defects found and corrected

- Added actual `DB_SCHEMA=planbuddy` search-path enforcement for shared Neon;
  the initial build only documented schema isolation.
- Closed credentialed arbitrary-origin CORS and added a production Origin check.
- Added tenant ownership validation to hunch-evidence reads.
- Prevented rejected AI candidates from being force-locked by direct API calls.
- Attached Not-this evidence to its persisted rejected plan for independent
  evidence accounting.
- Made positive/negative rating-only feedback teach the system without requiring
  a comment, and exposed explicit thumbs controls.
- Added accessible names to onboarding participant controls.
- Upgraded Vite/Vitest to patched releases after the initial audit flagged
  development-server advisories.

## 4. Final local results

- Type-check: **pass**
- Lint: **pass**
- Production build: **pass**
- Unit/contract/integration: **61/61 pass** across 7 files
- Browser journey: **1/1 pass** on mobile Chrome
- Dependency audit: **0 vulnerabilities**
- Visual inspection: **pass** on desktop and mobile

The browser console records one expected 401 for the initial anonymous
`/api/auth/me` probe; it is handled by the auth provider and is not an app
failure or leaked exception.

## 5. Readiness

The local MVP is accepted for merge and production deployment. The remaining
gate is a live Render/Neon/OpenRouter canary using deployed secrets and the real
DeepSeek model.

# PlanBuddy

PlanBuddy turns "what should we do?" into one lockable plan for the people
involved. It supports four scales — Day off, Weekend, Getaway, and Vacation
— as modes of a single engine, and learns safely from explicit choices and
feedback while keeping a fully inspectable household memory.

This is the local v1 MVP: a complete, runnable single-package application
(React/Vite/TypeScript client + Express/TypeScript API), built exactly to
[`PRODUCT-CONTRACT.md`](./PRODUCT-CONTRACT.md), ready for independent QA.

## The loop

1. Pick a scale, the people (and pets) involved, and a date window; add an
   optional one-sentence context note.
2. Press **Plan it**.
3. Get one confident recommendation with an honest rationale grounded in
   visible memory, weather, and recent history.
4. Lock it, browse a diverse alternate, explicitly say **Not this** with a
   reason, or tweak the spec and regenerate.
5. Afterward, rate it and optionally comment.
6. Anything learned — a constraint, a taste, a hunch — shows up in Memory
   with full provenance and full CRUD. Nothing learns silently.

## Stack

- **Client:** React + Vite + TypeScript, mobile-first (max 640px), no
  raster assets — hand-tuned "daylight editorial" CSS design system plus
  `lucide-react` vector icons.
- **Server:** Express + TypeScript, serving the built client and a JSON API
  under `/api`.
- **Database:** normalized Postgres (Neon-ready). See
  [`DB_SCHEMA.md`](./DB_SCHEMA.md). With no `DATABASE_URL` set, the server
  transparently falls back to an embedded `@electric-sql/pglite` database —
  same schema, same SQL, zero external setup required to run locally.
- **Auth:** email/password, Argon2id when the optional native `argon2`
  module is available (it installs cleanly on this stack), bcrypt cost-12
  fallback otherwise. Sessions are opaque 256-bit tokens in a signed,
  httpOnly, SameSite=Lax cookie, validated against a server-side session
  table.
- **AI:** DeepSeek V4 Flash via OpenRouter (`MODEL_ID`, default
  `deepseek/deepseek-v4-flash`) when `OPENROUTER_API_KEY` is set. With no
  key, PlanBuddy runs on a **deterministic local demo AI**
  (`src/server/ai/demoAi.ts`) that fabricates schema-valid candidates from a
  hand-authored content pool, seeded per (plan spec, batch) for replayable
  output — so the whole product is genuinely usable and testable offline,
  with zero external keys.
- **Weather/geocoding:** Open-Meteo, no key required, with in-memory
  caching and graceful "weather unavailable" fallback.
- **Place resolver:** pluggable interface; with no provider key configured
  the app runs in explicit **Inspiration mode** — it can name permanent
  geography and categories but never asserts a specific venue is currently
  open, per the venue-firewall principle.

## What's deterministic vs. AI-proposed

Per the product contract's core doctrine — "DeepSeek proposes; server code
disposes" — every candidate returned by the model (or the demo AI) passes
through a deterministic, replayable server-side pipeline before anything is
shown:

1. **Constraint filter** (`src/server/plans/engine/filter.ts`): a mechanical
   keyword-and-structure check independent of what the model claims about
   its own compliance. Rejects constraint violations, invalid citations,
   duplicate candidates, impossible travel radius, and venue-firewall
   violations (a candidate citing a specific venue when no live resolver
   payload backs it).
2. **Scoring** (`src/server/plans/engine/scoring.ts`): base fit 0.5 per
   participant; loved/avoided tastes add or subtract fit; hunches
   contribute at most ±0.15 and never appear in rationales; group fit is
   the **minimum** per-participant fit (least misery); feasibility folds in
   weather and travel distance; novelty penalizes repeat categories/venues
   from the last ten locked plans. Final score = 55% group fit + 25%
   feasibility + 20% novelty, with novelty breaking near ties.
3. **Alternates** are chosen from the same filtered, scored batch, one
   category away from the winner where possible — never a fresh unfiltered
   AI call.

## Memory model

Three tiers, all visible and fully CRUD-able in the Memory tab:

- **Constraints** — hard vetoes. Directly typed constraints are `verified`
  immediately. Chat-extracted constraints only become `active_unverified`
  (and start filtering immediately) after the server mechanically verifies
  the model's quote is a verbatim substring of the source message at the
  offsets it claimed (`src/server/memory/quoteVerify.ts`) — **quote or
  demote**: anything that fails becomes a non-filtering hunch instead.
- **Tastes** — loves/avoids that shape scoring but never veto.
- **Hunches** — weak, decaying, non-citable signals from rejections
  ("Not this" reasons) and post-plan feedback. They promote to a taste
  (never to a constraint) after three independent evidence events from
  distinct plans/sessions, and decay after six unreinforced plan
  generations or 90 days.

## Running it locally

```bash
npm install
npm run dev      # Vite dev server (5173) + Express API (4000), proxied
# or, production-style single process:
npm run build
npm start         # serves the built client + API on PORT (default 4000)
```

No `.env` is required to run — copy [`.env.example`](./.env.example) if you
want to point at a real Neon Postgres database or a real OpenRouter key.

## Verifying it

```bash
npm run typecheck   # client + server, strict TypeScript
npm run lint         # ESLint
npm run build        # vite build + tsc build, copies SQL migrations
npm test              # Vitest: unit + AI-contract + Supertest integration
npm run test:e2e     # Playwright: signup → onboard → generate → reject → lock → feedback → Memory
```

All of the above are green as of this build (59 Vitest tests, 1 Playwright
scenario, zero TypeScript or ESLint errors).

## What's intentionally out of scope for v1

- No live place-resolver integration is wired up (the pluggable interface
  exists; the app runs in Inspiration mode without a provider key).
- No Render/Neon deployment was performed in this session — this is local,
  build-verified work on the `build-mvp` branch, not pushed or deployed.
- No booking or detailed itinerary generation (by design — see the product
  contract's immutable principle #10).

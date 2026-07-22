# PlanBuddy — State

## Status
v1.1.2 "Wasp" is ready to deploy. Lisbon home plans now choose a concrete,
memory-matched, History-rotating trusted route before any network model call.
Other cities use one bounded OpenRouter plan call with a quality gate and
12-second fallback; DeepSeek V4 Flash remains the chat, feedback, and memory
model. Optional citations are supporting metadata and no longer cause dead
ends. 148 Vitest tests, typecheck, lint, build, and mobile E2E are green.

v1.1.0 "Wasp" is live at https://planbuddy.onrender.com from `main`
(`2543f18`). It adds a warm place-and-people canvas
and a persistent floating Buddy. Buddy is plan-aware when a plan is in view,
uses the shared background job lifecycle for edits, and preserves the original
ticket as a reversible version. 141 Vitest tests plus Playwright E2E are green.

v1.0.2 “Iron Man” is live at https://planbuddy.onrender.com from `main`
(`aaba309`), with dedicated Neon Postgres persistence (project
`aged-dream-11028120`). Plan generation is an async job with live named-stage
progress that survives tab switches and reloads; the app has an optional
taste-profile quiz, friend circles with block, and a logout control. Hardened
against Gemini outages (DeepSeek reasoning-starvation fix + fast failover).
128 Vitest tests + Playwright E2E green; adversarially reviewed by GPT-5.6
sol with executed repros; two live production canaries run on 2026-07-20.

## Next concrete action
Deploy v1.1.2, then run the exact Lisbon/Pom request against Render and verify
latency, Maps-ready places, and absence of the former citation dead end.

Hand the live app to alpha testers; collect feedback on recommendation quality, quiz usefulness, and circle selection before venue/calendar/booking integrations.

## Decisions made

- 2026-07-19 — One app, PlanBuddy, covers Day off, Weekend, Getaway, and Vacation as modes of one engine.
- 2026-07-19 — The home experience gives one confident pick; safe, diverse alternates are available on demand.
- 2026-07-19 — Plan, Chat, Memory, and History are top-level destinations.
- 2026-07-19 — Durable recommendations read only structured memory visible in Memory; raw chat affects only its bounded session.
- 2026-07-19 — Directly quoted or manually entered constraints protect immediately; inferred constraints never filter.
- 2026-07-19 — DeepSeek proposes candidates; server code validates, filters, scores, and selects them deterministically.
- 2026-07-19 — Group fit uses per-participant least-misery scoring plus visible-history novelty; no hidden rotation ledger.
- 2026-07-19 — “Show another” is neutral; only explicit rejection reasons and post-plan feedback teach preferences.
- 2026-07-19 — Getaway/Vacation return a destination anchor and three-beat trip shape, not bookings or full itineraries.
- 2026-07-19 — Deploy on Render with persistent Neon Postgres, email/password auth, and DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) through OpenRouter.
- 2026-07-19 — Visual language is warm daylight editorial, distinct from SleepBuddy; no raster asset is needed for v1.
- 2026-07-19 — Build implementation: single package (not a monorepo) with Vite building `dist/client` and `tsc` building `dist-server`; IDs are application-generated UUIDs (no pgcrypto dependency) so the same SQL runs unmodified on Neon and on an embedded PGlite fallback; server-side sessions (opaque token in a signed cookie) rather than JWT; deterministic keyword-based constraint filter (`src/server/plans/engine/constraintKeywords.ts`) rather than an NLU dependency; demo AI ships with a hand-authored content pool seeded per (spec, batch) for replayable output when no OpenRouter key is present.
- 2026-07-19 — Independent review hardened tenant isolation, CORS/origin checks, rejected-candidate locking, feedback learning, accessibility, dependency versions, and schema isolation.
- 2026-07-19 — Production release deployed to Render with dedicated Neon persistence. Live canary verified real DeepSeek planning/chat, constraint-safe filtering, learning, and fresh-login persistence.
- 2026-07-19 — Grounded planning uses a closed four-place Gemini Search dossier,
  exact-name canonicalization, and a source firewall before scoring/enrichment.
- 2026-07-19 — Plans expose real place photography, Google Maps place/direction/
  full-route links, estimated leg distances, coherent timing, apparel, bring and
  pet kits, checks, and a compact fallback.
- 2026-07-19 — A grounding outage may retry Gemini and then DeepSeek web search,
  but production never substitutes generic demo content for a real plan.
- 2026-07-19 — Love is the strongest explicit preference signal and stores a
  visible summary of reusable event features; Like remains a light signal.
- 2026-07-19 — Plan revisions are append-only and reversible. Restaurant and
  budget edits freeze non-meal stops; meal-time edits coherently retime the route.
- 2026-07-19 — Buddy can run every plan-level UI action: react, lock, share,
  show another, invite a friend, explain, and make scoped edits.
- 2026-07-19 — Friend connections grant planning participation, not access to
  raw memory, chat, history, hunches, or account editing.
- 2026-07-19 — Shared plans are immutable, scrubbed snapshots behind hashed,
  expiring, revocable tokens; they are not collaborative access grants.
- 2026-07-19 — Every surfaced winning suggestion enters History immediately as
  `suggested`; Lock and Not this update that same record instead of duplicating it.
- 2026-07-19 — Novelty uses the 20 latest surfaced plans and excludes recent
  titles, categories, and named venues in both provider prompts and deterministic
  ranking, while still respecting an explicit request to revisit something.
- 2026-07-19 — Gemini is optional. DeepSeek V4 Flash plus Exa/OpenRouter web
  search can run the complete grounded planning path; the deployed hybrid route
  remains enabled until an explicit provider switch is requested.

- 2026-07-20 — Plan generation is an async job (DB-backed, stage-reporting,
  idempotent, one active job per user DB-enforced); clients poll and reattach.
  Generation state lives in a GenerationProvider above the routes and survives
  navigation and reloads; failures surface in the cross-tab banner.
- 2026-07-20 — Optional 10-question taste quiz: answers map to canonical taste
  texts via a server-side catalog (client sends only answer ids); allergy
  answers become verified constraints; retake replaces quiz-sourced rows only.
- 2026-07-20 — Social v1 scope: reversible directional block (neutral errors),
  friend labels/circles (Family, Close friends, custom; many-to-many), one-tap
  circle chips and "Last group" in plan creation. Deferred by sol's review +
  agreement: RSVP, profiles, feeds, comments on shared plans.
- 2026-07-20 — Provider resilience doctrine: Gemini gets one 30s attempt then
  DeepSeek failover; DeepSeek reasoning models always get a reasoning cap +
  generous max_tokens + one direct-answer retry on length-starvation;
  memory-prefixed citations are stripped, never fatal; user-facing failure
  text never contains internal ids.
- 2026-07-20 — Versioning: hero-codename scheme adopted (v1.0.x "Iron Man");
  version pill hardcoded in PlanPage must be bumped with package.json.
- 2026-07-22 — v1.1.0 "Wasp": warm Airbnb-like place canvas plus a focused
  Intercom-like Buddy. The dock is plan-aware only when a plan is visible,
  otherwise it is normal memory chat. Detached edits are background jobs and
  keep the original ticket as a reversible version.
- 2026-07-22 — One-click doctrine restored: normal generation gets one bounded
  fast-model call; live web research is not on the critical path. Provider or
  schema or product-quality failure produces a useful deterministic plan, never a generic dead
  end. DeepSeek remains the conversational/memory model; `openai/gpt-4o-mini`
  handles only latency-sensitive structured plan drafting.

## Future ideas
- RSVP (Available / Maybe / Can't) on dated plans for included friends
- Comments/reactions on shared plans (ownership/privacy design needed first)

- Calendar connection and conflict-aware dates
- Booking/deep-link integrations
- Calendar-aware friend availability
- Notifications and post-plan reminders
- Detailed itinerary generation after the one-pick loop proves valuable

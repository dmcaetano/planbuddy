# PlanBuddy — State

## Status
v0.1.5 “Long Memory” is live at https://planbuddy.onrender.com from
`main` (`af8377d`, Render deploy `dep-d9ekr5bbc2fs738419r0`), with dedicated
Neon Postgres persistence. Every surfaced winner is now saved before the user
acts on it, and recent titles, categories, and venues actively suppress repeat
recommendations. Local and production QA are green.

## Next concrete action
Use the product with a real household and review recommendation/feedback quality before expanding venue, calendar, or booking integrations.

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

## Future ideas

- Calendar connection and conflict-aware dates
- Booking/deep-link integrations
- Calendar-aware friend availability
- Notifications and post-plan reminders
- Detailed itinerary generation after the one-pick loop proves valuable

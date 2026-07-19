# PlanBuddy — State

## Status
Local v1 MVP implemented, build-verified, and tested end-to-end on branch `build-mvp`. Not deployed. Ready for independent QA (e.g. Codex review of the branch).

## Next concrete action
Independent QA review of `build-mvp`. If accepted: provide a live `OPENROUTER_API_KEY` for a DeepSeek canary, provision Neon and set `DATABASE_URL`, run `npm run migrate`, and deploy to Render. See PROGRESS.md "Known gaps" for the full list.

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
- 2026-07-19 — Local MVP build completed and verified (typecheck/lint/build/unit/contract/integration/E2E all green); not deployed or pushed this session. See PROGRESS.md for full detail and known gaps.

## Future ideas

- Calendar connection and conflict-aware dates
- Booking/deep-link integrations
- Shared household invitations and per-member accounts
- Notifications and post-plan reminders
- Detailed itinerary generation after the one-pick loop proves valuable

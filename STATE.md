# PlanBuddy — State

## Status
Product definition complete; implementation starting.

## Next concrete action
Scaffold the TypeScript web app and normalized Postgres schema, then implement authentication and the memory model before recommendation generation.

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

## Future ideas

- Calendar connection and conflict-aware dates
- Booking/deep-link integrations
- Shared household invitations and per-member accounts
- Notifications and post-plan reminders
- Detailed itinerary generation after the one-pick loop proves valuable

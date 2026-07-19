# PlanBuddy database schema

Normalized Postgres schema, Neon-ready. Runs unmodified against a real
Postgres connection string or against the embedded local PGlite fallback
used when `DATABASE_URL` is unset (see `.env.example`). Source of truth:
`src/server/db/migrations/0001_init.sql`.

IDs are application-generated UUID v4 strings (`TEXT` columns) rather than
DB-generated UUIDs, so the schema has no dependency on the `pgcrypto` or
`uuid-ossp` extensions and behaves identically on Neon and PGlite.

Every table that stores user data has a `user_id` (directly or via a parent
row) so every query can be tenant-scoped; cross-tenant access is rejected at
the repository layer (returns 404, never leaks existence).

## Tables

| Table | Purpose | Key columns |
|---|---|---|
| `users` | One row per account. | `id`, `email` (unique), `password_hash`, `home_base_label/lat/lng` |
| `sessions` | Server-side session store backing the signed cookie. | `token` (pk), `user_id`, `expires_at` |
| `participants` | Household members: people and pets. | `id`, `user_id`, `name`, `kind` (`person`\|`pet`), `is_owner` |
| `constraints` | Hard vetoes, household- or participant-scoped. | `status` (`verified`\|`active_unverified`), `source` (`typed`\|`chat`), `source_quote`, `source_message_id` |
| `tastes` | Loves/avoids that shape scoring but never veto. | `polarity` (`love`\|`avoid`), `weight`, `source` (`stated`\|`onboarding`\|`promoted`) |
| `hunches` | Weak, decaying, non-citable preference signals. | `confidence`, `evidence_count`, `decay_at`, `status` |
| `hunch_evidence` | Append-only evidence log behind each hunch/promotion. | `hunch_id`, `plan_id`, `session_id`, `note` |
| `chat_sessions` | Bounded planning chat sessions. | `status` (`open`\|`ended`), `message_count` |
| `chat_messages` | Raw chat transcript; deleted 30 days after the session ends. | `session_id`, `role`, `content` |
| `plan_specs` | Versioned plan requests (scale, dates, radius, mood). | `scale`, `start_date`, `end_date`, `radius_km` |
| `spec_participants` | Join table: which participants a spec includes. | `plan_spec_id`, `participant_id` |
| `candidates` | Every AI-proposed candidate for a spec, pre- and post-filter. | `payload` (jsonb), `score_breakdown` (jsonb), `rank`, `rejected`, `rejection_reason` |
| `plans` | Locked or explicitly-rejected outcomes of a spec. | `status` (`locked`\|`rejected`), `beats` (jsonb), `weather` (jsonb), `place_provenance` (jsonb), `active_constraints` (jsonb) |
| `citations` | Normalized fact citations backing a locked plan's rationale. | `plan_id`, `fact_id`, `quote`, `source` |
| `feedback` | Post-plan rating/comment; source of learning evidence. | `plan_id`, `rating`, `comment` |
| `resolver_venues` | Cache of live place-resolver lookups (empty in Inspiration mode). | `external_id` (unique), `cache` (jsonb) |

## Cascades and retention

- Deleting a `participant` cascades their `constraints`, `tastes`, and
  `hunches` (personal memory), matching the contract's participant-deletion
  rule.
- `chat_messages` rows are deleted 30 days after their session's `ended_at`
  by a periodic sweep (`src/server/chat/retention.ts`); nothing else reads
  raw chat as durable memory, only structured `constraints`/`tastes`/
  `hunches` rows do.
- `candidates.payload` retains the full generation trace (all 8 raw AI
  candidates, validation/rejection reasons) for replay and QA, independent
  of which candidate was ultimately locked.

## Local zero-setup fallback

When `DATABASE_URL` is not set, `src/server/db/client.ts` opens an embedded
`@electric-sql/pglite` database on disk under `.data/planbuddy` (or
`PLANBUDDY_DATA_DIR`). It speaks real Postgres SQL, so the same migration
file and the same query code path run in both environments — there is no
schema drift between local dev and a deployed Neon database.

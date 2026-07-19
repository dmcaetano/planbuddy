# PlanBuddy — Log

## 2026-07-19 — Project start

### What we did
Named the product PlanBuddy, evaluated whether weekend/travel/vacation should be separate, and converged on one product. Ran three Codex–Fable discussion iterations under the Avengers workflow and froze the v1 contract.

### What we decided
The product’s moat is trusted, inspectable household memory; its magic is a single confident recommendation. Safety constraints are mechanically grounded and deterministic server logic controls filtering and ranking. The MVP includes full chat, memory, history, feedback learning, Render, Neon, and DeepSeek.

### What did not work
Foreground Claude CLI transport hung; background Claude sessions worked. The first background round attempted a broad scan, so subsequent discussion sessions explicitly denied tools and returned clean reasoning-only memos.

### Next
Implement, test, deploy, and verify the live application.

## 2026-07-19 — Local MVP built end-to-end

### What we did
Implemented the complete v1 MVP on branch `build-mvp` per the frozen
product contract: single-package React/Vite/TypeScript client + Express/
TypeScript server; normalized Postgres schema with a zero-setup embedded
PGlite fallback (same SQL runs on both); email/password auth with signed
httpOnly cookies and Argon2id/bcrypt-cost-12 password hashing; participants
including pets; full CRUD for constraints/tastes/hunches with mechanical
quote-or-demote verification of chat-extracted facts; a deterministic
constraint-filter → least-misery-scoring → novelty → diverse-alternates
recommendation pipeline sitting on a pluggable DeepSeek V4 Flash client
with a deterministic offline demo AI (used throughout, since no
`OPENROUTER_API_KEY` was available in this environment); bounded chat
sessions with 30-day raw-transcript retention; History with upcoming/past
plans; post-plan feedback feeding hunch evidence and eventual taste
promotion; and the warm daylight-editorial design system implemented
directly in CSS with vector icons only. Wrote 59 Vitest tests (unit,
AI-contract/schema, and Supertest integration against an in-memory PGlite
database) and one Playwright end-to-end happy-path scenario run against
the real production build.

### What we decided
Application-generated UUIDs instead of DB-generated ones, specifically so
the identical migration SQL runs on Neon and on PGlite with no extension
dependency. Server-side opaque session tokens in a signed cookie rather
than JWTs. A hand-authored, seeded, deterministic demo-AI content pool
(rather than skipping AI entirely) so the whole product — including the
constraint filter and scoring engine — is genuinely exercised without any
external key. A mechanical keyword-based constraint filter rather than an
NLU dependency, deliberately reproducing the venue-firewall and quote-or-
demote principles as testable, replayable server-side logic.

### What did not work (and was fixed)
Two real bugs surfaced only by running the actual build rather than trusting
typecheck/unit tests alone: (1) the server's static-file path pointed at
`dist-server/client` instead of the real Vite output `dist/client`, which
would have 404'd the whole client outside of `npm run dev` — caught by
running Playwright against the production build. (2) History classified a
just-locked, future-dated plan as "past" because node-postgres parses
`DATE`/`TIMESTAMPTZ` columns into JS `Date` objects, silently breaking a
string comparison (`Date >= string` coerces via `NaN`, always false) —
caught by manual curl smoke-testing, fixed with a `toDateOnlyString`
normalization helper.

### Next
Independent QA of `build-mvp`. Then: live DeepSeek canary with a real
`OPENROUTER_API_KEY`, Neon provisioning + `DATABASE_URL` + `npm run migrate`,
Render deployment, and a live Lighthouse/accessibility pass. Not deployed,
pushed, or exercised against live external services in this session.

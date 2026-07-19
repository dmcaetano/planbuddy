# PlanBuddy v1 Product Contract

This contract is the source of truth for the initial build. It was agreed after three Codex–Fable discussion rounds on 2026-07-19.

## Product promise

PlanBuddy turns “what should we do?” into one lockable plan for the people involved. It supports four scales—Day off, Weekend, Getaway, and Vacation—while learning safely from explicit choices and feedback.

The smallest lovable loop is:

1. Select the scale, people, and date/window; optionally add one sentence of context.
2. Press **Plan it**.
3. Receive one confident, feasible recommendation with an honest explanation grounded in visible memory.
4. Lock it, show a diverse alternative, explicitly reject it with a reason, or tweak the spec.
5. Afterward, rate it and optionally comment.
6. See any learned taste or constraint in Memory, with provenance and full CRUD.

## Immutable principles

1. One recommendation at a time; alternatives only on demand.
2. Hard constraints are absolute vetoes. Directly typed constraints are verified; chat-extracted constraints become active-unverified only after the server verifies the returned quote against the source message. Inferred constraints never filter.
3. Durable planning reads only structured memory visible in Memory. Raw chat may influence the current session spec, never future recommendations.
4. DeepSeek proposes; server code disposes. Validation, constraint filtering, scoring, novelty, and final ranking are deterministic and replayable.
5. Group fit uses the minimum per-participant fit (least misery). A participant with no profile is neutral.
6. Hunches never appear in rationales, never filter, contribute at most ±0.15 to a participant’s fit, and decay after six relevant plans or 90 days.
7. “Show another” is neutral browsing. Only explicit Not-this reasons and post-plan feedback create learning evidence.
8. No silent learning and no silent loss: raw events persist before AI extraction; failures remain visible/retryable.
9. Closable businesses may appear only from a live place-resolver payload. Model prose may name permanent geography but cannot invent current venue facts.
10. Getaway/Vacation return a destination anchor plus exactly three trip beats; no bookings or detailed itinerary in v1.

## Primary navigation

- **Plan** — home and the one-click loop.
- **Chat** — free-form planning and knowledge capture; planning intent routes into the same recommendation pipeline.
- **Memory** — constraints, tastes, hunches, provenance, confirmation, and complete CRUD.
- **History** — upcoming and past locked plans, feedback, and the visible source of novelty.

## Onboarding

Target: under 90 seconds.

1. Sign up or sign in.
2. Home base: city → geocode → label/coordinates.
3. Participants: owner plus optional people/pets.
4. Optional per-person loves/avoids and explicit household hard constraints.
5. Land on a prefilled Day-off spec and generate the first plan.

## Plan states

- New spec: scale, dates, participant chips, radius, optional mood/context.
- Generating: cancellable skeleton/status.
- Recommendation: hero ticket card, rationale/citations, beats, weather, distance, place provenance, active constraints, actions.
- Browsing: candidate position, diverse alternatives, one regeneration batch, then honest looseners.
- Locked: confirmation and History entry.
- Failure: retryable AI error, weather-unavailable badge, resolver fallback to Inspiration mode, and explicit constraint-bound dead end.

## Memory trust model

- **Constraints:** verified or active-unverified; household- or participant-scoped; source quote and status visible; full CRUD.
- **Tastes:** stated/onboarding/promoted; participant-scoped; polarity and weight; full CRUD.
- **Hunches:** weak, decaying, non-citable; confidence/evidence/decay visible; confirm or dismiss.
- A preference hunch may promote after three independent explicit evidence events from distinct plans/sessions. Nothing promotes to a constraint.
- Quote-or-demote: an extracted direct statement must include a verbatim substring and valid offsets; otherwise it becomes a hunch.

## Recommendation pipeline

1. Build a spec and selected-participant context.
2. Read active structured memory, last ten locked plans, weather, and optional resolver facts.
3. Ask DeepSeek for eight schema-valid candidate concepts with constraint checks and fact IDs.
4. Reject schema failures, constraint failures, invalid citations, impossible radius, duplicate candidates, and venue-firewall violations.
5. Score each survivor per participant:
   - base fit 0.5;
   - loves add fit, avoids subtract fit;
   - hunch contribution is clamped to ±0.15;
   - group fit is the minimum participant fit;
   - feasibility incorporates weather/travel softly;
   - novelty penalizes recent categories and venues.
6. Final score: 55% group fit, 25% feasibility, 20% novelty; novelty breaks near ties.
7. Display the winner. Alternates must pass identical filters and be category/energy diverse.
8. Persist the full context snapshot, candidates, scores, selected result, and all later actions.

Default radii: Day off 25 km, Weekend 60 km, Getaway 250 km, Vacation destination-scale.

## DeepSeek contracts

All responses are JSON, Zod-validated, repaired once, and logged only with non-sensitive request metadata.

- **Generate:** exactly eight candidates (accept at least five after repair), beats, category/indoor tags, optional permanent destination anchor, resolver venue IDs only, rationale citations, constraint compliance, travel estimate.
- **Chat:** reply, spec updates, and structured extractions with participant, kind, text, quote/offsets, polarity, and confidence.
- **Feedback:** maps free text to guarded preference evidence only; it can never emit a constraint.

Use `MODEL_ID`, defaulting to the verified live OpenRouter slug `deepseek/deepseek-v4-flash`. Keys stay server-side.

## Data model

Normalized Postgres entities:

- users
- participants (people and pets)
- constraints
- tastes
- hunches and hunch_evidence
- bounded sessions and retained messages
- versioned plan_specs and spec_participants
- generated candidates with score breakdowns
- locked plans
- feedback
- resolver venues/cache
- citations

Every query is tenant-scoped. Participant deletion cascades their personal memory. Ended message transcripts are deleted after 30 days.

## Technical stack

- React + Vite + TypeScript, mobile-first PWA-ready web UI.
- Express + TypeScript API serving the built client on Render.
- Neon Postgres with migrations and normalized tables.
- Email/password auth, Argon2id where deploy-safe (bcrypt cost-12 fallback), signed httpOnly Secure SameSite=Lax cookie.
- OpenRouter server proxy using DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`).
- Open-Meteo weather/geocoding with caching.
- Pluggable live place resolver when an available provider key exists; otherwise explicit Inspiration mode.
- Zod contracts, Vitest unit/contract tests, Supertest integration tests, Playwright E2E.

## Security and privacy

- No API key in the client or repository.
- Mutation requests require same-origin/custom-header protection.
- Rate-limit auth and AI endpoints.
- Cross-tenant access returns 404.
- No trackers or third-party analytics in v1.
- Memory is the durable model: deleting a memory removes it from future prompt assembly.
- Raw chat is not ranking memory and is retained only for 30 days after its bounded session.

## Visual direction

“Weekend field guide”: warm daylight editorial and recognizably Buddy-family, but distinct from SleepBuddy.

- Paper `#FAF6EF`, ink `#26221B`, clay `#C75B39`, pine `#2F5D50`, honey `#E8A13D`, muted sky `#7FA8C9`.
- Fraunces for editorial display, Inter for UI.
- 14px cards, hairline borders, one restrained shadow, ticket/perforation motif for plan cards.
- Mobile-first single column (max 640px) with safe-area bottom navigation.
- Lucide-style editable vector icons; no raster asset in v1.
- Warm, unexclamatory voice; accessible contrast and reduced-motion support.

## Release gates

1. Typecheck and lint clean.
2. Unit and AI-contract tests green.
3. Auth/ownership and happy-path integration tests green.
4. Playwright path green: signup → onboard → generate → reject → lock → feedback → Memory.
5. Render live canary: one real generate and one real chat extraction validate.
6. Security checklist passes; keys remain server-only.
7. Mobile visual verification, no console errors, and Lighthouse target ≥85 where available.

## Definition of done for v1

A fresh user on the Render URL can sign up, onboard a home and participant, generate a plan respecting a typed constraint with weather context, browse alternatives without changing memory, add a quoted constraint through Chat and see it protect immediately in Memory, confirm/dismiss it, lock the plan, find it in History, and leave feedback that creates an inspectable hunch. Getaway and Vacation return a destination anchor plus three beats. All four tabs work, data persists in Neon, and all release gates are green.

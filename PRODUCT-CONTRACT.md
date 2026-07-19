# PlanBuddy v1 Product Contract

This contract is the source of truth for the initial build. It was agreed after three Codex–Fable discussion rounds on 2026-07-19.

## Product promise

PlanBuddy turns “what should we do?” into one lockable plan for the people involved. It supports four scales—Day off, Weekend, Getaway, and Vacation—while learning safely from explicit choices and feedback.

The smallest lovable loop is:

1. Select the scale, people, and date/window; optionally add one sentence of context.
2. Press **Plan my weekend** (or the equivalent label for the selected scale).
3. Receive one confident, feasible, decision-ready recommendation grounded in visible memory and current sources.
4. Lock it, show a diverse alternative, explicitly reject it with a reason, or tweak the spec.
5. Afterward, rate it and optionally comment.
6. See any learned taste or constraint in Memory, with provenance and full CRUD.

## Immutable principles

1. One recommendation at a time; alternatives only on demand.
2. Hard constraints are absolute vetoes. Directly typed constraints are verified; chat-extracted constraints become active-unverified only after the server verifies the returned quote against the source message. Inferred constraints never filter.
3. Durable planning reads only structured memory visible in Memory. Raw chat may influence the current session spec, never future recommendations.
4. Models propose; server code disposes. Validation, source filtering, constraint filtering, scoring, enrichment, novelty, and final ranking are deterministic and replayable.
5. Group fit uses the minimum per-participant fit (least misery). A participant with no profile is neutral.
6. Hunches never appear in rationales, never filter, contribute at most ±0.15 to a participant’s fit, and decay after six relevant plans or 90 days.
7. “Show another” is neutral browsing. Only explicit Not-this reasons and post-plan feedback create learning evidence.
8. No silent learning and no silent loss: raw events persist before AI extraction; failures remain visible/retryable.
9. Any named place or closable business must come from the current source-backed place dossier; the server rejects names and source URLs outside that dossier. Unverified operational facts remain visible checks.
10. Every scale returns exactly three chronological beats and one compact fallback. Getaway/Vacation add a destination anchor; no booking transaction occurs in v1.

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
- Recommendation: attributed hero image, rationale/citations, three timed beats, real places, Maps links, distance/walking/spend estimates, live weather, apparel/bring/pet preparation, operational checks, compact fallback, provenance, active constraints, and actions.
- Browsing: candidate position, diverse alternatives, one regeneration batch, then honest looseners.
- Locked: confirmation and History entry.
- Failure: retryable AI error, weather-unavailable badge, explicit demo mode without grounding keys, and an honest constraint-bound dead end.

## Memory trust model

- **Constraints:** verified or active-unverified; household- or participant-scoped; source quote and status visible; full CRUD.
- **Tastes:** stated/onboarding/promoted; participant-scoped; polarity and weight; full CRUD.
- **Hunches:** weak, decaying, non-citable; confidence/evidence/decay visible; confirm or dismiss.
- A preference hunch may promote after three independent explicit evidence events from distinct plans/sessions. Nothing promotes to a constraint.
- Quote-or-demote: an extracted direct statement must include a verbatim substring and valid offsets; otherwise it becomes a hunch.

## Recommendation pipeline

1. Build a spec and selected-participant context.
2. Read active structured memory, last ten locked plans, weather, home base, people, and pets.
3. Use Google Search grounding through Gemini to build a closed four-place dossier: primary meal, two distinct outdoor stops, and fallback meal.
4. Compose exactly one three-beat candidate using only the dossier; reject schema failures, constraint failures, invalid citations, impossible radius, duplicates, and any out-of-dossier place or URL.
5. Score each survivor per participant:
   - base fit 0.5;
   - loves add fit, avoids subtract fit;
   - hunch contribution is clamped to ±0.15;
   - group fit is the minimum participant fit;
   - feasibility incorporates weather/travel softly;
   - novelty penalizes recent categories and venues.
6. Final score: 55% group fit, 25% feasibility, 20% novelty; novelty breaks near ties.
7. Enrich the winner server-side with Maps URLs, walking-range reconciliation, Commons imagery, live-weather apparel, bring and pet kit, checks, and fallback.
8. Display the winner. Any regenerated alternative passes the identical grounding and filtering path.
9. Persist the full candidate, context snapshot, score, selected result, and all later actions.

Default radii: Day off 25 km, Weekend 60 km, Getaway 250 km, Vacation destination-scale.

## DeepSeek contracts

All responses are JSON, Zod-validated, repaired once, and logged only with non-sensitive request metadata.

- **Place research:** exactly four source-backed places with address, kind, source URL/label, factual note, roles, and photo search term.
- **Generate:** exactly one candidate with three beats, exact dossier place objects, category/indoor tags, walking/spend estimates, operational checks, fallback, optional destination anchor, rationale citations, and constraint compliance.
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
- Gemini 3.5 Flash with native Google Search for grounded planning; OpenRouter server proxy using DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) for chat, feedback, and bounded composition fallback.
- Open-Meteo weather/geocoding with caching.
- Server-generated Google Maps URLs and Wikimedia Commons image lookup with attribution; deterministic demo mode when grounding keys are absent.
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

A fresh user on the Render URL can sign up, onboard a home, people, and pets, then receive one grounded three-beat plan with real places, Maps links, an attributed image, distance/walking/spend estimates, detailed apparel and pet preparation, operational checks, and a fallback. A typed constraint is mechanically enforced; quoted Chat memory protects immediately; locked plans reopen richly in History; feedback creates an inspectable hunch. Getaway and Vacation add a destination anchor. All four tabs work, data persists in Neon, and all release gates are green.

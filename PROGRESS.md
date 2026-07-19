## Goal
PlanBuddy is a mobile-first Buddy-family web app that gives one confident, personalized plan for a day off, weekend, getaway, or vacation. It learns safely from explicit feedback and chat, remembers household members and pets, treats allergies and other hard constraints as inviolable, exposes every durable memory for review, and runs as an authenticated Render app backed by Neon Postgres with DeepSeek V4 Flash server-side.

## Roadmap

### Phase 1 — Foundation
- [ ] Scaffold React/Vite/TypeScript client and Express/TypeScript server
- [ ] Add normalized Neon schema and migrations
- [ ] Add email/password authentication and secure cookie sessions
- [ ] Establish warm daylight-editorial design system and responsive shell

### Phase 2 — Trusted memory
- [ ] Household and participant onboarding
- [ ] Full CRUD for constraints, tastes, and hunches
- [ ] Mechanical quote verification for chat-extracted facts
- [ ] Hunch decay, evidence, confirmation, dismissal, and taste promotion

### Phase 3 — Planning loop
- [ ] Plan specs for Day off, Weekend, Getaway, and Vacation
- [ ] Weather context and optional live-place resolver
- [ ] DeepSeek structured candidate generation with schema validation
- [ ] Deterministic constraint filter, least-misery scoring, novelty, and diverse alternates
- [ ] Lock, show-another, not-this, tweak, and honest failure states

### Phase 4 — Chat and feedback
- [ ] Top-level DeepSeek chat tied to bounded planning sessions
- [ ] Structured memory capture with visible provenance
- [ ] History with upcoming/past plans
- [ ] Post-plan feedback and self-improvement loop

### Phase 5 — Ship quality
- [ ] Unit, contract, integration, and Playwright tests
- [ ] Visual verification and accessibility/responsive pass
- [ ] Security/privacy review
- [ ] Render deployment with persistent Neon database
- [ ] Live generation/chat canary verification
- [ ] DESCRIPTION.md and DESCRIPTION.html

## Current state
Product strategy is complete after three Codex–Fable discussion rounds. The product contract is frozen; the workspace and tracking files now exist, but implementation has not started.

## Next steps
1. Scaffold the application and database.
2. Build auth, onboarding, and the memory spine.
3. Build the deterministic recommendation loop and DeepSeek contracts.
4. Add chat, history, feedback learning, and complete QA.
5. Deploy to Render with Neon and verify the live app.

## Log

### 2026-07-19 — Product contract frozen
Completed three independent Codex–Fable product rounds. Settled one-pick doctrine, four planning modes, participant-aware least-misery scoring, visible three-tier memory, immediate protection from quoted constraints, venue firewall, deterministic ranking, top-level chat, feedback-driven learning, and the Render/Neon/DeepSeek stack. Created the PlanBuddy workspace and tracking files.

# PlanBuddy — State

**SDLC class:** SOLO

## Status
v1.6.4: bounded the bad-signature table (periodic purge + hard 20k-row cap, oldest-first eviction, one row per IP; counter failures never affect requests). v1.6.3: persistent atomic per-IP failure counter; single-clock replay expiry.

v1.6.2: second security pass (bad-signature throttle per IP and only after verification; atomic replay claim; byte caps before parsing).

v1.6.1: security hardening of the Buddy Contract code (automated review of 3b25d4f). Fixed: (1) hub text in prompts is untrusted data: sanitised (control/bidi chars, delimiters, role markers, override phrases), quoted, capped at 12 lines/2000 chars, block says it is data; the accepted-candidate title is sanitised before it becomes a taste; (2) replay protection: omni_seen table (migration 0014) refuses a second use of any signed POST signature, GET /card stays idempotent, failed-signature rate limit; (3) hub tombstones may only remove the same user's hub-origin 'Wants to try:' tastes, never own tastes or constraints, ids validated and capped; (4) hub token and signing key encrypted at rest (AES-256-GCM, key from SESSION_SECRET; legacy plaintext re-sealed at boot); (5) stored link secrets only ever sent to the configured https OMNIBUDDY_HUB_URL (http localhost only outside production); hub responses size-capped and validated; (6) generic error messages, no hub/internal text leaked, no secrets in logs; (7) strict body validation (link code charset, action/undo/candidate/entity limits), link endpoint rate limit, hex-only signature format. Tests: omniContract.test.ts now 20.

v1.6.0 "Naruto": PlanBuddy implements Buddy Contract v1 so the OmniBuddy hub can connect (additive). Endpoints under /api/buddy: health (open, `{version, contract:1}`), card, act (primary|accept|undo with one-shot undo token), suggest (verified OSM-catalogue candidates or empty) are HMAC-signed only (X-Omni-Timestamp/Link/Signature, 5 min skew, constant-time compare; unsigned = 401); link is session-authenticated and keeps the same-origin guard. The card is read-only: it shows tonight's/the day's/weekend plan with "Lock tonight's plan", or `needs_data` naming the missing input; it never builds a plan. Memory (tastes, active constraints) is pushed to the hub `/api/ingest` after changes (digest diff + tombstones); constraints and health-like tastes are `app_only`, never family-visible; other people's tastes and hub-originated "Wants to try:" items are never pushed. Plan generation and chat prompts get the `=== FROM YOUR OTHER BUDDIES (shared by you) ===` block after PlanBuddy's own data (fails soft). Code: `src/server/omni/`, migration 0013, tests `tests/integration/omniContract.test.ts`; contract-check from the OmniBuddy repo: Conformant (8 checks). NOT built: a client UI to type the link code (the hub calls POST /api/buddy/link with the code from a signed-in browser session); until then linking needs that call.
**New env names (no new true secrets):** `OMNIBUDDY_HUB_URL` (Render, sync:false; https hub base URL, enables linking/push/context), optional `PLANBUDDY_PUBLIC_URL` (card deeplink, default https://planbuddy.onrender.com), `PLANBUDDY_TZ` (default Europe/Lisbon). Per-link signing keys and hub tokens are issued by the hub at link time and stored in table `omni_links`.

v1.5.1: the New plan button now floats beside the Buddy chat button on every page (removed from the Home header); from another page it opens Home and builds a fresh plan. Verified live at 390px. Family ledger row added (every Buddy gets one).

v1.5.0 "Trunks": zero-click philosophy (the goal behind max-one-click). A "New plan" button sits in the Home header in every state (ready, locked, error, loading); it posts `fresh:true` to /api/moment, which skips reuse, the locked cover and the per-spec ceiling and builds a new proposal. Home shows a plan with no taps; New plan is the escape hatch. Home was user-confirmed to have been set to Faro (the wrong-city report was a data issue).

v1.4.3 "Vegeta": wrong-city fix + planner/chat separation. Reuse of a stored moment plan now requires the same home base (rounded to 2 decimals, in the inputs fingerprint) and a travel estimate within 2x the radius, so a plan built for another city is never replayed. Buddy chat no longer plans: its snapshot has a read-only `planner` block (active worker job + last 3 plans) and the prompt says plans are built/edited only by the background Planner worker (jobs queue). The plan-lane chat already enqueued worker jobs. Not proven: why one production account kept a Faro plan (cannot read his data); an old phone build (v1.3.1) may also be cached.

v1.4.2 "Vegeta" (1.4.1 prompt-injection hardening: app snapshot is untrusted data; 1.4.2 replies in the user's language, composer waits for the session): Buddy is one assistant for the whole app. The dock only says "Editing this plan" while the plan page is in view (stale plan focus was the bug). Anywhere else Buddy answers questions about the app and the user's data (people, circle/friends, constraints, tastes, hunches, time off, home base, distances) from a per-user snapshot, and can change them (set_travel, home base, constraints, tastes, people/relationships, time off, hunches) through a server-side validated action list. Each applied change shows in chat with Undo; Memory refreshes live. Code: `src/server/chat/appAssistant.ts`, `src/client/components/AppliedChanges.tsx`. 8 new Vitest tests; whole suite green file by file (the single-process run crashes with ERR_IPC_CHANNEL_CLOSED, also on the pre-change baseline). Verified live at 390px: circle question answered from real data, "weekend 90 km, day 40 km" applied and showed in Memory, Undo restored 25/60.

v1.3.0 "Goku": distance from home is now the user's own setting (Memory > "How far from home", day/weekend sliders, stored on the user; defaults 25/60 km) and replaces my hard 10/25 km cap; Home shows the reason line plus a live step trail while a plan builds (progressive UX; models stay). Quality rules from reading live output: no museums/galleries for evening outings, no fountains/prison forts/cemeteries as stops, model told to answer in English and avoid ferry detours.

v1.2.2: Lisbon (catalogue) plans now use a model call to choose the route from a validated shortlist of real venues; deterministic planner is the fallback.

v1.2.0 "Batman" (max 1 click life): the app now opens on `/` with a proposal for the
current moment (Friday evening -> dinner, Saturday -> a day out, other days -> the
weekend), built from the household, tastes, weather and History, with a one-line reason,
scope chips (Tonight / A day out / This weekend / Trip) and Customize one tap away
(the old setup form lives at `/plan/custom`). Relationships (wife, ...) are editable in
onboarding, Memory and by telling Buddy; romantic framing only for owner + one local
partner. Time off is manual entry (Memory, or Buddy confirm chip) and drives a trip nudge
with cached local + farther ideas. Spec/plan: `sdlc/001-max-one-click/`. 334 Vitest + 4
Playwright journeys green. Fast-model benchmark (20 requests, 2026-10-05): DeepSeek V4
Flash 0% valid (every request hit the 12 s ceiling); gpt-4o-mini 85% valid, p95 10.6 s.
Bar (>=90% valid and p95 <= 12 s) not met, so FAST_MODEL_ID stays openai/gpt-4o-mini.

v1.1.4 "Wasp" is live on Render from `main` (`c8914b3`, deploy
`dep-d9gscnsvikkc73a1akc0`). It makes hero-photo lookup location-aware,
searches the exact route anchor and home-city fallback in parallel, rejects
irrelevant document scans, and prevents obscure Lisbon places from leaving the
ticket image-less. The full 162-test suite, typecheck, lint, production build,
and a real 390 px Lisbon render with a loaded 1280x360 Commons panorama are
green. The production canary loaded a relevant 1280x821 photograph of the
actual opening stop with no browser errors or horizontal overflow.

v1.1.3 "Wasp" is live on Render from `main` (`93cd33b`, deploy
`dep-d9glget7vvec739g8620`).
It replaces the three-route Lisbon shortcut with a bundled and Neon-cached 11k-place, 60 km
catalogue; excludes stops from the last 100 surfaced plans; adds plan controls,
20 fresh suggestions per setup, Start over, surgical tweak paths, and hunch edit/delete. The real-data matrix
passed 9 plans with 27 unique stops and all five tweak modes. 159 Vitest tests,
two mobile Playwright journeys, typecheck, lint, build, and visual inspection
are green. A second matrix against the deployed production service also passed
9 plans with 27 unique named stops and zero repeats; live generation completed
in 2.1-4.6 seconds. Live login, controls, plan rendering, Start over, Love
learning, hunch edit, and permanent hunch deletion were also verified.

v1.1.2 "Wasp" is live at https://planbuddy.onrender.com from `main` (`92f0d73`).
Lisbon home plans now choose a concrete, memory-matched, History-rotating
trusted route before any network model call.
Other cities use one bounded OpenRouter plan call with a quality gate and
12-second fallback; DeepSeek V4 Flash remains the chat, feedback, and memory
model. Optional citations are supporting metadata and no longer cause dead
ends. The exact production request completed in 1.5 seconds; repeat generation
had zero venue overlap. 148 Vitest tests, typecheck, lint, build, mobile E2E,
and live mobile visual inspection are green.

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
Watch Diogo's real opens of v1.2.0; then backlog: calendar import, notifications. Retry the DeepSeek fast-role benchmark with a lighter prompt/reasoning cap.

(older) Hand v1.1.4 to alpha testers and continue refining restaurant quality ranking
from real reactions.

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

- 2026-10-05 — North star "max 1 click life": the app opens on a proposal for the
  current moment (time of day, day of week, household, tastes, weather, History,
  and life dates) instead of a setup form; one tap accepts, zero taps is the goal.
  Work is tracked as `sdlc/001-max-one-click/`.
- 2026-10-05 — Model routing: DeepSeek V4 Flash for every LLM role it can do, with
  guardrails; another model only for a capability DeepSeek lacks (Google grounding,
  images). Supersedes the 2026-07-22 `openai/gpt-4o-mini` planner role once guarded
  DeepSeek meets the latency bar.

- 2026-10-05 — Guiding principle: anything that gives passive information about the
  user is important (the user has no time to feed the app). Prefer signals read
  without user effort; when two designs are otherwise equal, choose the one that
  needs less input from Diogo.

- 2026-10-05 — Fast plan-draft role moved to DeepSeek V4 Flash (reasoning disabled, provider sorted by latency, AI_FAST_TIMEOUT_MS 25000). Initial 12 s benchmark was invalid for a reasoning model; re-run: 90% valid, p95 15.3 s.

## Backlog — must-have features (Diogo, 2026-10-05)
- **Calendar import** (time off, free windows, busy slots) as a passive signal. Not now:
  it still needs too much of Diogo's involvement to connect. MentorAI-app already has a
  calendar import, so it is feasible and easy — reuse it when this is picked up.
- **Notifications / push / email when the app is closed** — the "less than one click"
  end state (e.g. a Friday 18:30 nudge with the proposal already attached).
- Other passive-signal sources to evaluate: device location and time zone, weather,
  public holidays and school calendars, past plan feedback (already learned).

## Future ideas
- RSVP (Available / Maybe / Can't) on dated plans for included friends
- Comments/reactions on shared plans (ownership/privacy design needed first)

- Calendar connection and conflict-aware dates
- Booking/deep-link integrations
- Calendar-aware friend availability
- Notifications and post-plan reminders
- Detailed itinerary generation after the one-pick loop proves valuable


## To-do: Buddy family unification (Diogo, 2026-10-05)
Source of truth: `~/.claude/skills/buddy-chat/references/family-ledger.md` (your column) + `what-is-a-buddy.md` "Family standard" + `Projects/2026 Claude/_meta/buddies/`. Do these when you next work here; flip the ledger cell when done.
- Stack Cloudflare Pages Functions + React/Vite/TS (Render only if a free resource needs it); shared Supabase account + `buddy` memory schema; EN + PT-PT at onboarding.
- **Max 1 click is DONE (1.2.0): it is the model for the others** (ledger row exists). TODO: chat from L0-1 to L1-2 (server persona + data block + CURRENT STATE, markdown rendering, validated actions with Undo, rate limit); expose quote-or-demote (`memory/quoteVerify.ts`) as the shared implementation; EN + PT-PT; PWA; delete account + export; stop the silent fallback to demo AI; migrate constraints/tastes/hunches/feedback to the unified tables.

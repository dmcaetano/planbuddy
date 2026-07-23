# PlanBuddy — Log

## 2026-07-23 — v1.1.4 hero-photo reliability

### What we did
Fixed the missing hero regression reported after a successful Faro test. The
Wikimedia resolver had been appending Lisbon to every photo query and depended
on a single exact venue term. It now searches the route anchor and the actual
home city in parallel, filters document scans and weak location matches, and
falls back to an attributed city photograph when an obscure stop has no usable
Commons media.

### What we tested
Added regressions proving Faro remains Faro and an obscure Lisbon venue uses
the Lisbon city fallback. A real local mobile plan loaded a 1280x360 Lisbon
panorama with attribution and no horizontal overflow. All 162 tests across 23
files, typecheck, lint, and production build passed.

## 2026-07-23 — v1.1.3 catalogue diversity

### What we did
Removed the hard-coded three-route Lisbon production shortcut. Added a durable
60 km OpenStreetMap/Overpass catalogue cached in Neon, three-provider mirror
failover, request/cuisine scoring, geographic distance bands, compact route
construction, and strict exclusion of every stop in the last 100 surfaced
plans. Added advanced one-click controls, a visible Start over action,
deterministic surgical tweaks, and full learned-hunch edit/delete controls.
The explicit per-setup generation ceiling was also raised from two to twenty;
the old cap was a second direct cause of the reported two-result experience.

### What we tested
The live-source acceptance harness loaded 11,185 places and generated three
plans for each of three different setups: nine plans, 27 unique stops, no
repeats. Restaurant, meal-time, budget, walking, and outdoor tweaks all passed
preservation checks. Typecheck, lint, build, 159 Vitest tests, two Playwright
mobile journeys, and mobile screenshot inspection passed.

### What failed and changed
One Overpass endpoint returned HTTP 504 during the acceptance rerun. Catalogue
refresh now fails over across three independent mirrors and retains the last
known-good Neon snapshot, so an upstream outage cannot collapse the product
back to a tiny route set.

The first Render canary showed that all three large refreshes could fail from
the production network. The verified 11,185-place snapshot now ships with the
server and seeds Neon at boot; external refresh is maintenance, never a cold-
start dependency.

The live tweak canary exposed that outdoor `tourism=attraction` stops were
classified like indoor activities, so their loop time disappeared from the
displayed walking total. Only museums and galleries are now treated as indoor
visits; monuments, viewpoints, gardens, and similar stops count toward the
selected walking range.

### Production result
Render deploy `dep-d9glget7vvec739g8620` is live from commit `93cd33b`.
Production boot seeded Neon from the bundled 11,185-place Lisbon snapshot.
The requested 3-setup x 3-run production matrix returned nine plans with 27
distinct named stops and no repeats; individual plans completed in 2.1-4.6
seconds. A live mobile browser verified v1.1.3, all six planning controls, a
complete detailed plan, and Start over. Live Love feedback created reusable
feature hunches, and both hunch editing and permanent deletion persisted.

## 2026-07-22 — v1.1.1 one-click planner recovery

### What we did
Traced the reported production failure through Render logs. A single request
spent about 90 seconds on DeepSeek web research and 54 seconds composing after
Gemini rejected Lisbon location use twice, then the deterministic filter threw
away the plan solely because of an unverifiable optional memory citation.
Rebuilt the hot path as one structured call to `openai/gpt-4o-mini` with a
12-second ceiling, while keeping DeepSeek V4 Flash for chat, feedback, and
memory. Added a concrete rotating Lisbon/Pom fallback with real places, Maps
links, timing, distance, per-person cost, clothing/pet preparation, and current-
facts checks. Invalid citations are stripped rather than fatal; weather and
photo calls are short best-effort enrichment.

### What we decided
The product invariant is useful plan first. Web research and citation metadata
may improve a plan but may never block the one-click answer. Hard constraints
remain deterministic vetoes; optional explanatory citations do not.

### What did not work
DeepSeek V4 Flash still missed the 12-second plan deadline. GPT-4.1 Mini returned
valid output in 14.5 seconds; GPT-4o Mini returned valid structured output in
8.8 seconds and was selected for the narrow planner role. The first fallback
implementation changed the normal test/demo pool and broke two integration
assumptions; it was isolated to the production failure path and the complete
147-test suite returned green. A final live-model canary exposed a repeated
Cais do Sodré stop and generic food-hall meal; the new deterministic quality
gate rejected it and returned the stronger Estrela → Peixaria da Esquina →
Jardim Teófilo de Braga route in 7.7 seconds.

The first v1.1.1 production canary completed in 9.6 seconds with Maps, clothing,
Pom kit, cost, and History persistence, but it still chose Time Out Market.
That was not good enough. v1.1.2 bypasses the network model for Lisbon's home
flow and selects from a trusted route pack using explicit tastes, feedback
hunches, dislikes, the current request, and recent History. The planner step is
1 ms locally; other cities retain the bounded model plus the stricter market,
duplicate-stop, and lake quality gates. Full suite: 148 Vitest + mobile E2E.

Render deploy `dep-d9gki5vaqgkc73d0vafg` is live from `92f0d73`. The final
production canary completed in 1.5 seconds with the Estrela/Peixaria route,
Maps, cost, apparel, Pom and gluten checks, and History persistence. An
immediate repeat rotated to the Necessidades/Último Porto route with zero place
overlap. The v1.1.2 badge and mobile layout were visually verified live.

## 2026-07-22 — v1.1.0 "Wasp" release candidate

Implemented the approved warm place canvas and persistent Buddy directly,
using the Opus review only as an architectural critique. Buddy is mounted
above routes, understands the visible plan, and uses the same background job
lifecycle as generation. A scoped edit keeps the current ticket visible,
survives tab changes, and resolves into a reversible comparison with the
original plan. The visual layer adds soft coral/plum warmth, editorial heading
scale, scoped real-participant avatars, stronger ticket elevation, and the
responsive Buddy dock. Verification passed: 141 Vitest tests, mobile
Playwright E2E, TypeScript, lint, build, audit, and desktop/mobile visual review.
Committed as `2543f18`, pushed to `main`, and verified live on Render: deploy
`dep-d9gjnl6rnols73drarkg` is live, `/api/health` reports `{ "ok": true }`,
and the served production client contains the v1.1.0 + Buddy dock bundle.

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

## 2026-07-19 — Reviewed and released to production

### What we did
Reviewed the Claude/Sonnet handoff independently, fixed persistence and tenant
safety gaps, upgraded vulnerable development dependencies, added explicit
thumbs learning, verified the responsive UI, and merged the MVP to `main`.
Published https://github.com/dmcaetano/planbuddy and deployed
https://planbuddy.onrender.com on Render with dedicated Neon project
`aged-dream-11028120` in Frankfurt.

### Live issues found and fixed
The first database target had exhausted its transfer quota, so PlanBuddy was
moved to its own Neon project. The large DeepSeek request then exposed provider
latency, JSON-envelope variability, and a false positive where “gluten-safe”
was treated as a gluten violation. Added bounded provider routing, conservative
JSON-envelope normalization followed by Zod validation, and safe-context-aware
mechanical filtering with regression tests.

### Result
The final public canary passed health, signup/login, household and pet memory,
real DeepSeek recommendation and chat, two hard constraints on the winning
ticket, lock, feedback-to-hunch learning, chat extraction, and persistence
after a fresh login. All 68 Vitest tests, Playwright, typecheck, lint, build,
visual review, and dependency audit are green.

## 2026-07-19 — v0.1.1 “Lisbon Field Guide” grounded release

### What we did
Compared the desired answer shape across GPT-SOL, Claude Fable, and Claude
Opus, then rebuilt recommendation output around a closed four-place Gemini
Search dossier. Added exact-name place canonicalization and a source firewall,
three distinct chronological stops, server-generated Google Maps place/
directions/full-route links, real Wikimedia Commons photography, reconciled
walking totals and distances, spend, weather-aware apparel and bring lists, a
Pom kit, operational checks, and a compact fallback. Saved plans now reopen as
the same rich ticket in History with the scheduled date.

### Live issues found and fixed
Production canaries exposed mutated grounding redirect URLs, inconsistent
walking classification, transfer-heavy walking totals, NUL characters rejected
by Postgres JSONB, meal descriptions that were misclassified as walks, Lisbon
park ponds described as lakes, impossible activity timing, and a transient
empty Gemini dossier that silently activated generic demo content. Each issue
now has a deterministic guard or provider retry/fallback. Production returns an
honest 503 if all grounded providers fail; it never presents demo inspiration
as a real recommendation.

### Result
Render deploy `dep-d9eg1khoagis7399nd70` at commit `f21acad` is live. The exact
Lisbon/Pom production canary returned three real stops, three Maps and three
directions links, one full route, an attributed photo, €35–50 per person, and
60 independently recomputed walking minutes. Lock, rich History, feedback, and
hunch evidence persisted in Neon. All 77 Vitest tests, the mobile Playwright
journey, typecheck, lint, build, and live 390×844 visual inspection are green.

## 2026-07-19 — v0.1.4 “Social Learning” release

### What we did
Added Like, Dislike, and Love across suggestions and History. Love extracts a
visible, reusable feature summary and writes idempotent evidence into the
existing hunch loop. Added private, immutable itinerary sharing; expiring
one-time friend invites and mutual connections; explicit friend selection with
private least-misery group planning; and a persistent plan-scoped Buddy that can
run every plan-level action. Tweak is now append-only and reversible. Restaurant,
meal-time, budget, and walking edits preserve the smallest possible scope.

### Live issues found and fixed
Mobile visual QA caught a meal detector replacing an arrival walk when every
beat inherited the candidate's `food` category. The live canary then caught a
temporary Gemini demand spike during a restaurant swap; common swaps now use
the plan's already-grounded nearby fallback immediately, preserving the two
route anchors and the source firewall. Public-share inspection caught a generic
`You` label corrupting the word `your`; redaction now uses whole-word matching
and excludes pronouns, with regression coverage.

### Result
Final Render deploy `dep-d9ek30bbc2fs7383judg` at commit `4f28b38` is live.
A real Lisbon canary learned four venue-agnostic preferences from Love, replaced
only Saldanha Mar with Baía do Peixe while keeping Parque Eduardo VII and Jardim
Amália Rodrigues, refreshed the Maps route, kept “Back to original,” and created
a privacy-safe share link. All 86 Vitest tests across 14 files, the full mobile
Playwright journey, typecheck, lint, build, dependency audit, and visual review
are green.

## 2026-07-19 — v0.1.5 “Long Memory” release

### What we did
Made History capture every surfaced winning suggestion immediately, before Lock,
Love, Like, Dislike, or any other action. Added a dedicated Saved suggestions
section whose tickets reopen with full detail and all actions. Lock and rejection
now transition the same plan record instead of creating duplicate history rows.
Expanded the anti-repeat loop from locked-plan titles to the 20 most recent
surfaced plans, carrying titles, categories, and normalized named venues into
both grounding/composition prompts and deterministic novelty scoring. Backfilled
older rank-one candidates so prior recommendations participate immediately.

### Issues found and fixed
The first end-to-end run exposed an ordering regression: putting Saved
suggestions before Upcoming caused an existing history test to reopen the wrong
card. Upcoming remains first, while unselected suggestions stay fully accessible
below it. Direct Dislike now creates reversible negative hunch evidence, and
changing the reaction removes that evidence without duplicating the existing
Not-this or post-plan learning paths.

### Result
Render deploy `dep-d9ekr5bbc2fs738419r0` at commit `af8377d` is live. A production
canary showed the first exact Lisbon request in Saved suggestions before Lock,
preserved its Love reaction on reopen, and moved the same row to Upcoming after
Lock. Repeating the identical request changed the route from Alfama (Miradouro de
Santa Luzia → Restaurante Lautasco → Sé de Lisboa) to Cacilhas (Farol de Cacilhas
→ Escondidinho de Cacilhas → Elevador da Boca do Vento), with no venue overlap.
All 89 Vitest tests across 15 files, the Playwright mobile journey, typecheck,
lint, build, dependency audit, mobile/desktop visual review, and live health and
version checks are green.

## 2026-07-20 — v1.0 alpha release ("Iron Man")

### What we did
Ran the avengers-assemble campaign to take v0.1.5 to an alpha-shareable v1.0:
async plan-generation jobs with live named-stage progress surviving tab
switches and reloads; optional 10-question taste-profile quiz; social v1
(block, circles/labels, one-tap circle chips, "Last group"); visual polish
(skeletons, form classes, empty states); logout control. Shipped v1.0.0
(111dc4e) then v1.0.1 (612653a) after adversarial review and live QA.

### What we decided
Architecture dual-tracked with GPT-5.6 sol (independent convergence on the
DB-backed job design). Circles shipped lightweight against sol's
defer-recommendation because Diogo asked explicitly; RSVP/feeds/profiles
deferred. Provider doctrine: one fast Gemini attempt then DeepSeek, reasoning
caps + direct-answer retry mandatory for DeepSeek reasoning models.

### What did not work (and was fixed)
E2E caught fold+dismiss losing a finished plan on remount. Sol's repros caught
a job-uniqueness race, failed→succeeded resurrection, stale-plan resurrection
after Buddy edits, post-logout polling, blocked friends leaking into circle
summaries, and a quiz payload writing 160 rows. Live canary caught production
generation failing 4/4 during a Gemini 503 storm — root cause was our own
DeepSeek composition call (6k max_tokens, no reasoning cap → 24.5k reasoning
tokens, zero content) plus a too-tight abort budget; also a silently vanishing
failure banner and the complete absence of a logout button. A pre-existing
1-in-6 e2e flake (fixed banner overlapping bottom controls) was root-caused
and fixed in passing.

### Next
Alpha testers on v1.0.1; watch failover behavior in Render logs; then
place/booking truth and calendar awareness.

## 2026-07-21 — v1.0.2 hotfix: fallback compose timeout

### What we did
Diogo hit "Grounded planning is temporarily unavailable" live. Render logs
showed the Gemini failover working but the DeepSeek web-search fallback
aborting at exactly its 90s AI_COMPOSE_TIMEOUT_MS with no second attempt.
Raised the compose budget to 210s (background jobs have no HTTP deadline;
only the 10-minute sweep bounds it) and added exactly one retry on
abort-like errors for webSearch/heavy calls. Shipped v1.0.2 (aaba309);
live canary then produced a real Belém itinerary in under a minute on the
first attempt.

### Lesson
When adding provider timeouts, budget for the fallback chain end-to-end,
not per-call in isolation — a "resilience" cap that is tighter than the
provider's real latency under load just converts slow successes into
failures.

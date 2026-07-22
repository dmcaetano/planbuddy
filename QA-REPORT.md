# PlanBuddy QA report

## v1.1.3 “Wasp” — catalogue diversity release (2026-07-23)

### Phase 1 — Inventory

1. Lisbon local discovery: 60 km OpenStreetMap/Overpass catalogue, three-mirror failover, weekly Neon cache, background warm-up, and exact-radius filtering.
2. Route composition: three real sourced stops, compact walking legs, cuisine/request matching, distance-band exploration, Google Maps enrichment, weather/apparel, and a nearby restaurant fallback.
3. Novelty: every surfaced plan enters History, the last 100 surfaced plans exclude all previously used stop names, and each setup permits 20 fresh suggestions rather than stopping at two.
4. One-click setup: scale, dates, participants, free-text context, radius, meal time, walking range, per-person budget, setting, and transport, with useful defaults.
5. Plan actions: Show another, Lock, Share, Love/Like/Dislike, visible Start over, reversible Buddy editor, and restaurant/time/budget/walking/outdoor tweaks.
6. Memory: constraints/tastes CRUD plus learned-hunch list, confirm, dismiss, edit text/person/polarity, and permanent delete.
7. Existing regression surface: auth/onboarding, friends, sharing, History, chat, background jobs, persistence, privacy, error/loading/dead-end states, and mobile navigation.

### Phase 2 — Procedures

1. Run TypeScript, ESLint, all unit/contract/integration tests, production build, and both Playwright mobile journeys.
2. Fetch the real Lisbon 60 km catalogue. Generate three plans for each of three setups (meal/walk/Pom, outdoor budget lunch, indoor culture/public transport), carrying every surfaced stop into the next run’s History exclusions.
3. Assert nine winners, exactly three sourced stops each, and zero repeated stop names across all 27 stops.
4. Apply restaurant, meal-time, budget, walking, and outdoor edits. Assert restaurant/budget change only the meal and all other edits preserve every venue.
5. On mobile, expand controls, change all six values, generate, Love, Start over, then edit and delete the learned hunch.
6. Inspect 390×844 screenshots of the expanded controls and hunch editor for clipping, overlap, wrong target, and bottom-navigation clearance.
7. After deployment, verify the visible version, health, catalogue warm-up, three successive live plans, History persistence, all tweak modes, Start over, and hunch edit/delete.

### Phase 3 — Local execution

- TypeScript: **PASS**
- ESLint: **PASS**
- Production build and ten migrations: **PASS**
- Unit/contract/integration: **PASS — 159/159 across 22 files**
- Playwright mobile: **PASS — 2/2**
- Real catalogue matrix: **PASS — 11,185 places; 9 plans; 27/27 unique surfaced stops; 5/5 tweak modes**
- Visual verification: **PASS — controls and hunch editor at Pixel 7 dimensions**

### Phase 4 — Defects found and fixed

- Removed the three-route Lisbon shortcut that caused the same results.
- Replaced it with a durable large catalogue and strict recent-stop exclusion.
- Added resolver-ID membership validation so catalogue-backed claims cannot invent a venue.
- Added Overpass mirror failover after the acceptance run caught an upstream 504, then bundled the verified 11,185-place snapshot after Render could not complete any large refresh. Cold starts no longer depend on an external catalogue request.
- Reused one 60 km cache for smaller radius settings so moving a slider does not trigger another slow discovery fetch.
- Skipped local-place discovery for getaway/vacation flows, which do not use the local composer.
- Added immediate surgical edits so timing/walking/outdoor changes do not wait on a model or replace unrelated stops.
- Added missing hunch edit/delete and visible Start over controls.

### Phase 5 — Production canary

Pending deployment of v1.1.3. The section below is retained as an older release record.

---

Version **0.1.5 — “Long Memory”**
Reviewed 2026-07-19 by Codex after GPT-SOL, Claude Fable, and Claude Opus product-output comparisons.

## Phase 1 — Feature inventory

1. **Authentication and onboarding:** signup, login, logout, session restore,
   home geocoding, owner plus people/pets, empty/loading/error/success states.
2. **Plan input:** four scales, start/end dates, participant toggles, optional
   context, scale-specific one-click label, generating, success, dead-end,
   provider error, and no-more-generations states.
3. **Grounded recommendation:** attributed hero image; title/rationale and
   memory citations; fit/weather/sunset badges; walking, spend, and full-route
   summary; exactly three chronological stops; real place/address/source;
   Google Maps place, directions, and route links; estimates; apparel, bring,
   and pet kit; weather rule; operational checks; fallback; provenance.
4. **Plan actions:** Lock, Show another, reversible Tweak, Share, and
   Like/Dislike/Love. Buddy chat can run every plan-level action and make
   restaurant, meal-time, budget, walking, or general edits.
5. **History and feedback:** every surfaced winner is saved immediately;
   Saved suggestions, Upcoming, and Past & disliked lists reopen the full rich
   ticket with Lock, Share, Like/Dislike/Love, 1–5 stars, optional comment, and
   visible feature learning.
6. **Chat and memory:** bounded DeepSeek chat, quote-verified constraint/taste
   extraction, visible constraints/tastes/hunches, confirmation/dismissal, CRUD,
   provenance, decay and taste promotion.
7. **Persistence and tenancy:** Neon/Postgres production storage, PGlite local
   fallback, signed-cookie sessions, tenant-scoped reads/writes, CSRF/origin
   guard, rate limits, and 30-day ended-chat retention.
8. **Friends and sharing:** expiring one-time invites, mutual friendship,
   explicit participant selection, least-misery group planning, privacy-safe
   immutable share snapshots, token hashing, expiry, and revocation.
9. **External/config states:** Gemini grounding present/absent, DeepSeek present/
   absent, Open-Meteo available/unavailable, Commons image found/not found,
   Render env secrets, and visible `v0.1.5 · long memory` release marker.
10. **API surface:** `/api/health`; auth signup/login/logout/me/home-base;
   participants CRUD; constraints CRUD; tastes CRUD; hunch read/action/evidence;
   weather; plan-spec create/read/regenerate/not-this/lock/tweak; history list and
   reactions, shares, friend invites/connections, feedback, bounded memory chat,
   and persistent plan-scoped chat/action operations.

## Phase 2 — Procedures

1. Run strict client/server TypeScript, ESLint, production build, dependency
   audit, 89 unit/contract/integration tests, and the Playwright mobile journey.
2. Generate locally with the exact Lisbon prompt and remembered Saldanha home,
   18:30 meal, 45–60 minute easy walk, €35–50 preference, and Pom needs.
3. Confirm the response is `gemini-grounded`, contains four source-backed
   dossier places, three distinct chronological route stops, and no invented
   lake or out-of-dossier URL.
4. Inspect every Maps/place/source link, hero-image URL and attribution,
   total-walking normalization, spend estimate, operational checks, apparel,
   bring list, Pom kit, weather rule, and fallback.
5. Render the plan at 390×844 and 1280×900, inspect clipping, overflow,
   collisions, image crop, bottom-navigation clearance, and responsive columns.
6. Execute signup → onboarding → generation → rejection → regeneration → lock →
   rich History reopen → feedback → Chat extraction → Memory visibility.
7. Confirm a newly generated winner appears in Saved suggestions before any
   action, then reacts and locks in place without creating a duplicate.
8. Repeat an identical request and verify the route has no avoidable title,
   category, or named-venue overlap with the recently surfaced plan.
9. After deployment, poll Render until live, check health and visible version,
   then repeat a real grounded generation and critical persistence flow on the
   production URL.

## Phase 3 — Local execution results

- Type-check: **PASS**
- ESLint: **PASS** (zero errors and zero warnings)
- Production build: **PASS**
- Unit/contract/integration: **PASS — 89/89 across 15 files**
- Playwright mobile journey: **PASS — 1/1**
- Real Gemini + Search Lisbon generation: **PASS**
- Google Maps URL generation/source firewall: **PASS**
- Open-Meteo weather and weather-aware apparel/Pom preparation: **PASS**
- Wikimedia Commons lookup and attribution: **PASS**
- Visual inspection at mobile and desktop: **PASS**
- Rich locked-plan reopen from History: **PASS**
- Mobile Love → Buddy edit → share → dislike → lock journey: **PASS**
- Friend authorization, stale-friend rejection, and cross-account privacy: **PASS**
- Share token hashing, immutable snapshot, expiry/revoke, and prose-safe redaction: **PASS**
- Restaurant swap preserves both non-meal stops and keeps the original reversible: **PASS**
- Unselected suggestion persists, reopens, reacts, and locks without duplication: **PASS**
- Repeat request receives deterministic recent-title/category/venue suppression: **PASS**

The browser console records one expected 401 for the initial anonymous
`/api/auth/me` probe; the auth provider handles it and no app exception leaks.

## Phase 4 — Defects found and corrected

- Removed the generic “lakeside” path by requiring a Google Search-backed place
  dossier and rejecting every place/source URL outside it.
- Replaced one generic activity beat with exactly three chronological stops and
  changed place research to provide two distinct outdoor anchors around a meal.
- Prevented minor structured-copy length misses from discarding an otherwise
  grounded plan and cascading into the demo fallback.
- Canonicalized every composed place back to the server-held dossier object so
  harmless redirect-URL mutations cannot create a false firewall dead end while
  genuinely unknown names still fail closed.
- Reconciled walking activity plus transfer time to an explicit remembered
  walking range; classification reads the title, description, category, and
  place kind so a garden beat cannot disappear from the total.
- Added mandatory hours, reservation/terrace, pet-policy, and menu/price checks.
- Replaced fuzzy Wikipedia page images with ranked Wikimedia Commons file search
  and penalized insect, close-up, tile, flag, and sculpture results.
- Added full rich-ticket reopening in History instead of degrading saved plans
  to plain text beats.
- Kept tests deterministic even when local key-file configuration exists by
  forcing demo mode under `NODE_ENV=test`.
- Sanitized NUL characters at the JSONB persistence boundary after a live
  Gemini payload exposed PostgreSQL's otherwise-valid-JSON incompatibility.
- Protected meal duration from walking-language false positives, normalized
  impossible displayed start times, and rewrote Lisbon “lake” framing to
  accurate park/ornamental-pond language.
- Added one Gemini dossier retry plus a grounded DeepSeek web-search fallback;
  production now returns an honest 503 instead of silently showing demo content
  when both grounding providers are unavailable.
- Corrected History to show the scheduled event date and added that date to the
  full ticket header.
- Replaced the lossy Tweak flow with append-only versions and a persistent
  plan-scoped Buddy conversation.
- Corrected meal-stop identification when all beats inherited a food category;
  a restaurant edit now changes the actual dining beat, never the opening walk.
- Made common restaurant swaps resilient to provider spikes by using the
  plan's already-grounded nearby fallback before requesting new research.
- Tightened public-share redaction to case-insensitive whole words and excluded
  generic pronouns so privacy scrubbing cannot corrupt ordinary prose.
- Persisted rank-one surfaced candidates as `suggested` and backfilled historical
  winners, so History no longer begins only after Lock or rejection.
- Replaced title-only novelty with recent surfaced-plan exclusions covering
  titles, categories, and normalized named venues in prompts and server scoring.
- Made direct Dislike evidence reversible and prevented duplicate negative
  evidence when Not-this or post-plan feedback already records the signal.
- Restored Upcoming ahead of Saved suggestions after E2E caught ambiguous first-
  card ordering, without reducing access to unselected recommendations.

## Phase 5 — Production canary

**PASS** on final Render deploy `dep-d9ekr5bbc2fs738419r0`, commit `af8377d`.

- Exact Lisbon/Pom request returned `gemini-grounded`, `deadEnd=false` in 28.9s.
- Winner: **A Scenic Saldanha Walk & Fresh Grilled Fish Dinner with Your Pom**.
- Three distinct grounded stops: Jardim do Arco do Cego → Saldanha Mar →
  Parque Eduardo VII; three place links, three directions links, and one full
  Google Maps route.
- Walking reconciliation: displayed **60 min**, independently recomputed
  **60 min**, approximately **4 km**; spend **€35–50 per person**.
- Meal remained 75 minutes; the last stop moved to 19:58 so meal plus transfer
  chronology is possible. No “lake” copy remained.
- Real Commons hero photo and attribution, four apparel items, two bring items,
  three Pom-kit items, operational checks, and a grounded restaurant fallback.
- Lock persisted in Neon, rich History reopen passed, feedback persisted, and
  one new hunch-evidence item was created.
- Mobile live inspection at 390×844 passed with no overflow; History showed
  **Sat, 25 Jul 2026** and the ticket header showed **Sat 25 Jul**.
- Love extracted four venue-agnostic features from a real grounded Lisbon plan.
- Buddy replaced only Saldanha Mar with the already-grounded Baía do Peixe,
  preserving Parque Eduardo VII and Jardim Amália Rodrigues exactly, returning
  a refreshed Maps route in about five seconds, with “Back to original” visible.
- Buddy created a private share link; the public page exposed the itinerary and
  live Maps links while omitting citations, constraints, per-person scores, and
  the home-origin directions leg.
- A new grilled-fish-and-walk winner appeared in Saved suggestions before any
  action, reopened with its full ticket, retained Love learning, and moved to
  Upcoming on Lock using the same plan row; Saved suggestions then became empty.
- Repeating the exact request produced Cacilhas instead of Alfama: Farol de
  Cacilhas → Escondidinho de Cacilhas → Elevador da Boca do Vento, with zero
  named-place overlap against the first route.

## Readiness

Local and production release gates are green. Version 0.1.5 is live and ready
for real household use at https://planbuddy.onrender.com.

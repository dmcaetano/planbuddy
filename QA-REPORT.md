# PlanBuddy QA report

Version **0.1.1 — “Lisbon Field Guide”**
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
4. **Plan actions:** Lock it, Show another, Not this with reason, Tweak, and
   direct API rejection of an unsafe/rejected candidate.
5. **History and feedback:** upcoming/past lists, reopen the full rich ticket,
   thumbs, 1–5 stars, optional comment, and feedback-to-hunch evidence.
6. **Chat and memory:** bounded DeepSeek chat, quote-verified constraint/taste
   extraction, visible constraints/tastes/hunches, confirmation/dismissal, CRUD,
   provenance, decay and taste promotion.
7. **Persistence and tenancy:** Neon/Postgres production storage, PGlite local
   fallback, signed-cookie sessions, tenant-scoped reads/writes, CSRF/origin
   guard, rate limits, and 30-day ended-chat retention.
8. **External/config states:** Gemini grounding present/absent, DeepSeek present/
   absent, Open-Meteo available/unavailable, Commons image found/not found,
   Render env secrets, and visible `v0.1.1 · grounded` release marker.
9. **API surface:** `/api/health`; auth signup/login/logout/me/home-base;
   participants CRUD; constraints CRUD; tastes CRUD; hunch read/action/evidence;
   weather; plan-spec create/read/regenerate/not-this/lock/tweak; history list and
   feedback; chat session/message/end operations.

## Phase 2 — Procedures

1. Run strict client/server TypeScript, ESLint, production build, dependency
   audit, 71 unit/contract/integration tests, and the Playwright mobile journey.
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
7. After deployment, poll Render until live, check health and visible version,
   then repeat a real grounded generation and critical persistence flow on the
   production URL.

## Phase 3 — Local execution results

- Type-check: **PASS**
- ESLint: **PASS** (zero errors and zero warnings)
- Production build: **PASS**
- Unit/contract/integration: **PASS — 71/71 across 9 files**
- Playwright mobile journey: **PASS — 1/1**
- Real Gemini + Search Lisbon generation: **PASS**
- Google Maps URL generation/source firewall: **PASS**
- Open-Meteo weather and weather-aware apparel/Pom preparation: **PASS**
- Wikimedia Commons lookup and attribution: **PASS**
- Visual inspection at mobile and desktop: **PASS**
- Rich locked-plan reopen from History: **PASS**

The browser console records one expected 401 for the initial anonymous
`/api/auth/me` probe; the auth provider handles it and no app exception leaks.

## Phase 4 — Defects found and corrected

- Removed the generic “lakeside” path by requiring a Google Search-backed place
  dossier and rejecting every place/source URL outside it.
- Replaced one generic activity beat with exactly three chronological stops and
  changed place research to provide two distinct outdoor anchors around a meal.
- Prevented minor structured-copy length misses from discarding an otherwise
  grounded plan and cascading into the demo fallback.
- Reconciled walking activity plus transfer time to an explicit remembered
  walking range; the Lisbon canary now displays **60 minutes** total.
- Added mandatory hours, reservation/terrace, pet-policy, and menu/price checks.
- Replaced fuzzy Wikipedia page images with ranked Wikimedia Commons file search
  and penalized insect, close-up, tile, flag, and sculpture results.
- Added full rich-ticket reopening in History instead of degrading saved plans
  to plain text beats.
- Kept tests deterministic even when local key-file configuration exists by
  forcing demo mode under `NODE_ENV=test`.

## Phase 5 — Production canary

Pending deployment of `v0.1.1`; this section is completed only after the Render
deploy and live grounded Lisbon flow pass.

## Readiness

Local release gates are green. Production readiness remains pending the final
Render deploy and live canary.

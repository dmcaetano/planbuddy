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
   audit, 77 unit/contract/integration tests, and the Playwright mobile journey.
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
- Unit/contract/integration: **PASS — 77/77 across 11 files**
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

## Phase 5 — Production canary

**PASS** on Render deploy `dep-d9eg1khoagis7399nd70`, commit `f21acad`.

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

## Readiness

Local and production release gates are green. Version 0.1.1 is live and ready
for real household use at https://planbuddy.onrender.com.

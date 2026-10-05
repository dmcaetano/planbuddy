# Spec: Max 1-click life — PlanBuddy opens on the answer
Derived from: intent.md (commit 7557b86) · Status: draft (rev 2, after a FAIL review)
Items marked ◇ are choices Claude made to make the intent buildable; Diogo can overrule any of them.

## Behaviour

### A. The moment (Increment 1 — passive signals only: device clock, weather, household, memory, History)
1. When the app opens for a logged-in user with onboarding complete, the **Home** screen resolves the
   **moment** from the device's local date and time, sent with the request, and shows a proposal
   with no taps and no form first.
2. The moment is one of three kinds, chosen from the device's local time (the rows cover every
   minute of the week exactly once):

   | Device local time | Kind | Plan date |
   |---|---|---|
   | Mon 00:00 – Thu 23:59 | `weekend` | the coming Saturday |
   | Fri 00:00–12:59 | `weekend` | the coming Saturday |
   | Fri, Sat or Sun 13:00–20:59 | `tonight` | today |
   | Fri 21:00–23:59 | `day` | Saturday |
   | Sat 00:00–12:59 | `day` | Saturday (today) |
   | Sat 21:00–23:59 | `day` | Sunday |
   | Sun 00:00–12:59 | `day` | Sunday (today) |
   | Sun 21:00–23:59 | `weekend` | the coming Saturday |

3. What each kind means ◇. `tonight` is a dinner-centred evening plan. `day` is a lunch-centred day
   plan. `weekend` is today's weekend plan with today's Saturday timing. Mapping to the existing
   machinery: `tonight` and `day` use the Day-off scale (25 km) with a dinner or lunch meal timing;
   `weekend` uses the Weekend scale (60 km); trips use the Getaway scale (local, 250 km) and the
   Vacation scale (farther).
4. Timing ◇. `tonight`: the first beat starts at S = the later of (moment + 30 minutes, rounded up to
   the next quarter hour) and 16:30. If S is 19:00 or later the meal is the first beat; otherwise the
   meal is the second beat and starts between 19:00 and 21:00. The meal never starts after 22:00. For a
   plan dated after today, S is 16:30.
   `day`: S = the next full hour at least 60 minutes after the moment and not before 10:00 (for a
   plan dated after today, 10:00). If S is 12:00 or later the lunch is the first beat; otherwise the
   lunch is the second beat and starts between 12:00 and 15:00. A late meal-first plan carries the
   existing "check opening hours" note.
5. Each proposal has a **moment key**: the kind plus the plan date (for example `tonight:2026-10-09`).
   Reuse is by key plus an **inputs fingerprint** ◇: the group's participant ids, their active
   constraints and their relationships. The newest non-rejected plan with the same key and the same
   fingerprint is reused, creating nothing new. Any change to those inputs (a new allergy, a new
   relationship, a person added or removed) changes the fingerprint, so the next open produces a new
   proposal that obeys them. Taste changes do not.
6. A reused `tonight` or `day` plan dated today whose first beat has already started is **retimed in
   place** ◇ (all venues kept) using the existing deterministic retiming, saved as an append-only,
   reversible revision, not a new plan. If the meal-start window in rule 4 can no longer be met, a new
   proposal is generated instead. Plans dated after today and `weekend` plans are never retimed.
7. Show another and Not this create a new proposal under the same key and fingerprint, subject to the
   existing 20-generations-per-setup ceiling and its existing message. A new key or fingerprint starts
   a new setup. Opening the app never counts against that ceiling when it only reuses.
8. A **locked plan covers the moment** when its date equals the plan date and, for a plan dated today,
   its last beat has not yet ended. Then Home shows that locked plan and creates no suggestion.
9. The 2026-07-19 and v1.1.3 decisions still hold for every new proposal: it enters History as
   `suggested`, and the named stops of the last 100 surfaced plans are excluded. Rules 5–7 are what
   keep idle opens from consuming that window.
10. **Who it is for ◇:** the whole household (the owner, the other people and the pets) and no friend
    accounts. Choosing friends or a different group is done in Customize. Hard constraints, memory
    visibility and privacy apply exactly as today, and Home applies the constraint filter again to a
    reused plan.
11. **Reason line.** Every proposal shows one line of parts, each traceable to something the app holds:
    the moment ("Friday evening"), the people (names, or "you and your wife"), one taste or hunch that
    the planner reports as the match for the winning plan, quoted as stored, and ◇ one weather clause
    when a forecast exists for that date. A part with no source is omitted. The line is assembled by the
    server from these parts, never written freehand by a model. A taste is quoted only from the
    viewer's own and household-scoped memory, never from a friend account.
12. **Romantic framing.** When the group's people are the owner plus exactly one other **local household
    person** whose relationship is a partner word ◇ (wife, husband, partner, spouse, girlfriend,
    boyfriend, fiancé, fiancée, esposa, marido, mulher, namorada, namorado, noiva, noivo, companheira,
    companheiro), pets are ignored for this test, and the kind is `tonight`, the request carries a
    romantic-dinner intent and the line says "romantic evening". Otherwise the wording is neutral. A
    connected friend account never triggers it in this unit (its relationship cannot be stored by the
    owner today); that is a backlog item.
13. **Scope switch** ◇. Under every proposal one tap switches to each other scope (Tonight, A day out,
    This weekend, Trip) with the same group: Tonight uses today's date while the moment is before 21:00
    and tomorrow otherwise; A day out uses today's date while the moment is before 13:00 and tomorrow
    otherwise; This weekend uses the coming Saturday; Trip uses the time-off range's
    dates when a trip nudge exists and otherwise opens Customize preselected to Getaway. A visible
    Customize action opens the existing manual form prefilled with the group and kind.
14. **Plan actions on Home** (intent item 4). From the proposal: one tap Locks it, one tap Shows
    another, Not this, Tweak and the reactions work as they do today, and Buddy is aware of the visible
    plan (Home registers it as the focused plan).
15. **Loading.** An existing proposal appears with the page. If one must be generated, a skeleton with
    moment-specific text ("Finding your Friday dinner…") appears at once and the proposal replaces it.
    The screen is never blank or a dead end: on failure the existing deterministic fallback or error
    handling applies and Customize is offered.
16. **Relationship data.** Each local person's relationship can be set, edited and cleared in
    onboarding and in Memory, and by telling Buddy ("Dani is my wife") ◇. A Buddy-proposed change is
    saved only after one tap on a confirm chip. If Buddy cannot find the named person it says so and
    offers to add them.

### B. Time off (Increment 2)
17. In Memory a **Time off** section lists the user's ranges (label, start date, end date) and lets
    them add, edit and delete one (delete asks for confirmation). Telling Buddy "I'm off Dec 24 to 31"
    proposes the entry as a confirm chip ◇, saved only on one tap.
18. A **trip nudge** exists ◇ for the earliest time-off range that ends today or later, starts within
    183 days, is not snoozed, and overlaps no locked plan of Getaway or Vacation scale (a locked dinner
    or weekend plan inside the range does not count).
19. The nudge card shows a line built from stored facts (the range's dates and one stored taste, quoted
    as stored) and **two trip ideas** ◇: one local (reachable on a Getaway) and one farther, each a
    destination name with a short reason. The ideas are lightweight text: opening the app creates no
    plan rows and no History entries and does not use the one-active-job slot. The ideas are cached
    per time-off range and taste set, refreshed when the range is edited or after 14 days, and on
    demand with "Other ideas". A model writes the destination names and reasons under guardrails:
    schema-validated, a farther destination not already in the user's recent plans, and no price,
    flight or availability claims.
20. Tapping an idea runs the existing generation for that destination and the range's dates as one
    normal job (Getaway scale for the local idea, Vacation scale for the farther one).
21. A season-bound taste is cited on the nudge only when the dates fit its season ◇ (snow, ski,
    winter: December to March; beach, swim: June to September); otherwise it is not cited.
22. Precedence ◇. (a) A locked plan covering the moment is shown (rule 8). (b) For kind `tonight` or
    `day`, the moment proposal leads and the nudge, if any, is a smaller card below it. (c) For kind
    `weekend`, the nudge leads if it exists, with "Plan this weekend" one tap away; otherwise the
    weekend proposal leads.
23. "Not now" on the nudge hides it for 7 days ◇. Editing the range clears that, and the Time off row
    has a "Show again" action. The Trip scope option remains available meanwhile.
24. When no time-off entry exists, the Home screen, reason lines and nudge never mention vacation or
    time off. (Customize and History keep their existing wording; Memory shows its empty Time off
    section.)

### C. Model policy
25. Every LLM role in the product (plan drafting on the fast path, trip ideas, chat, feedback and
    memory extraction, Buddy action routing, event features) runs on DeepSeek V4 Flash with the
    existing guardrails (reasoning cap, direct-answer retry, schema validation, the deterministic
    quality gate). Another model is used only where DeepSeek lacks the capability (Google grounding,
    images); neither is on the live path today and this feature needs neither.
26. The fast plan-draft role moves off `openai/gpt-4o-mini` only after a measured bar ◇: over at
    least 20 requests that actually reach the model (other cities, trips, and Lisbon requests where
    the catalogue planner returns nothing; Lisbon catalogue requests are excluded), at least 90% return
    schema-valid output that passes the quality gate and the 95th-percentile time is at most 12
    seconds (the existing ceiling). If the bar is met, both the code default and the deployment
    setting that pins the fast model are changed. If not, that one role stays and the numbers go to
    Diogo; nothing is switched silently.
27. Lisbon `tonight`, `day` and `weekend` proposals normally have no LLM call on their critical path
    (the catalogue planner is deterministic); when it returns nothing, the model path runs and rule 26
    applies.

## Data
- Device clock: the request carries the device's local date-time as a strict local ISO string with a
  sane year range; it resolves the moment and is not stored. ◇ The server does not compare it with its
  own clock, so a browser test clock works against production. The endpoint is rate-limited like the
  other model-backed endpoints.
- Plans and plan specs gain: moment kind, moment key, plan date, inputs fingerprint, and the stored
  reason parts (so reopening shows the same line). Reason parts are excluded from public share
  snapshots.
- `life_dates` (new, tenant-scoped like every user table): label, start date, end date, snoozed until,
  timestamps; end never before start.
- `trip_ideas` (new, tenant-scoped): the time-off range, the taste-set fingerprint, the local and
  farther idea (name, reason), created at.
- Participants already have a `relationship` column and an update route; no schema change. Friend
  accounts are untouched.
- No new external service, key or provider.

## Interfaces
- **Routes ◇:** `/` is Home and the "Plan" nav tab points to it. The existing planning page moves to
  `/plan/custom` (reached by Customize) with its content unchanged, and `/plan` and unknown paths
  redirect to `/`.
- Moment endpoint: given the device's local date-time, returns kind, key, plan date, reason parts, and
  either a ready plan, a locked plan, or a generation job followed through the existing job lifecycle
  (it survives tab switches and reloads); it also returns the trip nudge with its cached ideas.
- Time-off endpoints: list, create, update, delete, snooze, un-snooze (tenant-scoped; 404 across
  tenants). The existing participant update route is reused for relationship.
- Buddy gains two confirm-before-write actions, set relationship and add time off. For tests there is a
  deterministic path for the plain phrasings; the model handles the rest.

## Constraints
- Hosting: Render with Neon, as today (the Render plan is the free tier, so the first request after
  idle can be slow). The product runs off Diogo's machines, so the hosted exception to the "local LLM
  = Claude Code CLI" rule applies; DeepSeek V4 Flash was approved by Diogo on 2026-10-05. No metered
  Anthropic API anywhere.
- No fabricated data: nothing is displayed that the app has no record of (rules 11, 19, 21, 24). The
  trip ideas are labelled as ideas, not facts.
- Complete CRUD for everything user-entered that this unit adds: relationship (set, edit, clear), time
  off (add, edit, delete, snooze and un-snooze).
- Background work survives tab switches and reloads (reuses the generation job lifecycle).
- UI language follows the existing English app; mobile-first at 390 px; keyboard operable, visible
  focus, touch targets of at least 44 px, loading state announced to screen readers, reduced-motion
  respected by the skeleton, contrast per the existing design tokens.
- Out of scope (confirmed by Diogo, in the must-have backlog): calendar import, notifications.

## Acceptance
Each item is a check a person or script can run and get pass or fail. Local items run against the real
build; live items against production after deploy.
1. **Moment table.** Unit tests cover rules 2 and 5 at these device times, each asserting kind, plan date
   and key: Mon 09:00, Wed 14:00, Thu 23:30, Fri 00:00, Fri 12:59, Fri 13:00, Fri 20:59, Fri 21:00,
   Sat 02:00, Sat 06:00, Sat 12:59, Sat 13:00, Sat 20:59, Sat 21:00, Sun 02:00, Sun 12:59, Sun 13:00,
   Sun 20:59, Sun 21:00. A test also asserts every minute of a sample week maps to exactly one row.
2. **Timing (rule 4).** Fri 14:00 → first beat 16:30, meal second, starting 19:00–21:00. Fri 19:00 →
   first beat 19:30 and it is the meal. Fri 20:59 → meal first, starting 21:30 (never after 22:00). The Tonight chip at Fri 22:00 gives a plan
   dated Saturday whose first beat is 16:30.
   Sat 06:30 → first beat 10:00, lunch second. Sat 11:00 → first beat 12:00 and it is the lunch. The
   quality gate and the deterministic retiming accept a meal-first order (new tests), and the other
   kinds' existing tests stay green.
3. **Reuse and fingerprint.** Two requests with the same key and inputs return the same plan id and
   leave exactly one `suggested` History row. After adding a constraint or setting a relationship, the
   next request returns a new plan that obeys it. Show another creates a second plan under the key.
   A new key creates a new row. Repeated opens never change the generation count toward the ceiling.
4. **Stale timing (rule 6).** A `tonight` plan made at 16:00 and opened at 20:30 on the same date is
   retimed in place with the same venues and appears as one reversible revision; a `day` plan whose
   lunch window can no longer be met is replaced by a new one; no new History row appears for a retime.
5. **Locked.** With a locked plan covering the moment (rule 8), the endpoint returns it and creates no
   row; a locked plan whose last beat has ended today does not cover a `tonight` moment; a locked
   Saturday plan covers a Fri 22:00 `day` moment dated Saturday.
6. **Constraints.** With a stored allergy, a moment proposal and a reused one never violate it.
7. **Reason line.** In every test, each part carries a reference that exists in that user's data; no
   tastes → no taste clause; no forecast → no weather clause; a taste owned by a friend account is
   never quoted; a Lisbon plan's cited taste is the one the planner reported as matching; share
   snapshots contain no reason parts.
8. **Romantic framing.** Owner + one local "wife" + a dog, Friday evening → framing; relationship
   unset → neutral; owner + two other people → neutral; friend-account partner → neutral; the
   friends list shows "PlanBuddy friend" unchanged.
9. **Relationship UI.** On a 390 px browser, set, edit and clear a relationship in onboarding and in
   Memory; tell Buddy "Dani is my wife", see the confirm chip, decline once, confirm once; tell Buddy
   about a name that does not exist and see the offer to add them.
10. **Time off CRUD.** Add, edit, delete, snooze and "Show again" for a range in Memory; add one by a
    Buddy confirm chip; cross-tenant requests return 404.
11. **Nudge.** With a range in the next 183 days and no trip plan: Wed 14:00 → the nudge leads with two
    ideas and "Plan this weekend" works; Fri 19:00 → the dinner leads and the nudge is a smaller card;
    a locked dinner inside the range does not remove the nudge, a locked Getaway or Vacation plan
    does; "Not now" hides it for 7 days (clock-advanced test); opening the app five times creates zero
    plan rows and at most one idea-generation call; tapping an idea runs one normal job. With zero
    ranges, the Home screen, reason lines and nudge contain no vacation or time-off wording.
12. **Season guard.** A "loves snow" taste is cited for a December range and not for a July range.
13. **Model bar.** A benchmark script runs the rule-26 mix; its numbers go into LOG.md; the model
    default and the deployment pin change only if the bar is met, otherwise Diogo is told the numbers.
14. **Plan actions and Buddy (rule 14).** On Home, Lock, Show another, Not this, Tweak and a reaction
    each work, and Buddy answers a question about the visible plan using that plan.
15. **Live canary** (production, real browser with a controlled clock, a dedicated canary account with a
    household of an owner, a wife and a dog and a few tastes, so Diogo's own account stays clean). After
    warming the service: opened at Fri 19:00, Sat 11:00 and Wed 14:00, the first screens show three
    different fitting proposals with zero taps; a reused proposal is visible within 1 second of load
    and a fresh Lisbon one within 5 seconds; 390 px has no horizontal overflow; screenshots of all
    three are inspected (visual-verify) before the push counts as done.
16. **Regression.** The existing 162 tests, typecheck, lint, production build and both mobile
    Playwright journeys stay green. The journeys are rewritten to enter through Customize (they
    currently start at `/` and click "Plan my weekend"); new tests cover items 1–14.

## Risks
- **Wrong or odd device clock.** The proposal fits whatever the device says; accepted, since the moment
  is the user's own and affects only them.
- **Novelty burn from idle opens.** Handled by the key, the fingerprint, in-place retiming and the
  no-plan-rows trip ideas (rules 5–7, 19).
- **Meal-first and the fixed three-beat shape.** The planner, the quality gate and the retiming assume
  the meal is the second beat; the build must change all three together (acceptance 2).
- **Tonight at 13:00–16:29 starts at 16:30.** Accepted ◇; someone opening at 13:00 gets an evening
  plan, not an afternoon one.
- **Partner framing misses a word or a connected spouse.** It stays neutral rather than guessing; the
  list can grow, and per-friend relationships are a backlog item.
- **DeepSeek too slow or malformed for the fast role.** Measured bar before any switch (rule 26); the
  deterministic fallback already protects the user either way.
- **Trip ideas overclaim.** No prices, flights or availability; the line around them is built from
  stored facts; ideas are cached and labelled as ideas.
- **Free-tier cold start** can break the 1 s and 5 s targets on the first request; the canary warms
  first, and a cold first open shows the skeleton.
- **Time off needs manual entry,** which cuts against "passive information". Accepted for now by
  Diogo; the calendar import in the must-have backlog removes it.
- **Season table is crude** (northern hemisphere, two tastes); it only decides whether a taste is
  cited, never whether a plan is allowed.
- **First open with an empty household or no tastes.** Onboarding still runs first; with no tastes the
  line carries only the moment and the people.

---
## Review
Verdict: PASS WITH NOTES
Reviewer: spec reviewer (independent, read-only) · model sonnet · 2026-10-05 (first pass on rev 2; the earlier FAIL was on rev 1, so this is not a second FAIL on the same artefact)
Findings (all notes, no blocker). Resolutions carried into plan.md:
1. Rules 25/26: the fast role staying on `openai/gpt-4o-mini` when the bar is missed is a documented, time-boxed exception, decided by Diogo's own "else report numbers"; the numbers go to him, nothing switches silently.
2. Rule 25 wording corrected: Gemini grounding already exists on the non-catalogue and trip path and is unchanged; this feature adds no new use of it. Trip ideas and the reason line use DeepSeek only.
3. Rules 11 / Acceptance 7: the catalogue planner must RETURN the matched taste (new build item). On the model path the taste clause is chosen by deterministic token overlap between a love taste and the plan text, and omitted when none overlaps.
4. Rule 22: under a locked plan covering the moment, a trip nudge (if it exists) still appears as the smaller card; a locked dinner/day plan never suppresses a nudge. Test added.
5. Rule 8: "covers the moment" uses date-range overlap (a locked Sat–Sun weekend plan covers a Sunday moment). Test added.
6. Rules 5/13: a Customize/scope-switch plan with tomorrow's date shares key `tonight:<tomorrow>` and is reused the next day if still valid; intended.
7. Acceptance 16: "both tests in e2e/happy-path.spec.ts"; the Buddy-edit and share steps run from Home after the rewrite.
8. Acceptance 15: Claude creates the dedicated canary account with generated credentials stored under `API Keys\`, never in the repo or chat.
9. Rule 16: relationship editors are new work in onboarding and Memory (the client has none today).
10. Rule 13: Trip with no nudge opens Customize on Getaway; accepted (◇).
11. Rule 26: 20 requests is an indicative smoke bar, reported as such; the run is extended to 40 if the first 20 sit near the thresholds.

---
## Amendment 2026-10-05
Rule 27 (Lisbon proposals have no LLM call on their critical path) is **deliberately overridden at Diogo's instruction**: Lisbon, and any city with a resolved place catalogue, MUST use a model call to choose the route. Design stays "DeepSeek proposes, the server validates": the real catalogue remains the only source of venues; the server builds a shortlist (~20 restaurants, ~6 nearby stops each), the fast model (DeepSeek, reasoning off, 25 s ceiling) picks ids plus a title and one-sentence reason, and every id is re-validated (exists, walkable, distinct, not recent, constraints). Any failure (timeout, schema, unknown id, validation) falls back to the deterministic catalogue planner with a logged warning. Demo/test mode is unchanged (deterministic, no call). Code: `src/server/plans/engine/catalogModelPicker.ts`, `catalogPlanner.ts` (`buildCatalogShortlist`, `buildCandidateFromPicks`).

# Spec: Max 1-click life — PlanBuddy opens on the answer
Derived from: intent.md (commit 7557b86) · Status: draft
Items marked ◇ are choices Claude made to make the intent buildable; Diogo can overrule any of them.

## Behaviour

### A. The moment (Increment 1 — passive signals only: the device clock, weather, household, memory, History)
1. When the app opens for a logged-in user with onboarding complete, the home screen resolves the
   **moment** from the device's local date and time, sent with the request, and shows a proposal
   with no taps and no form first.
2. The moment is one of four kinds, chosen by this table on the device's local time ◇:

   | Device local time | Kind | Plan date |
   |---|---|---|
   | Fri, Sat or Sun, 16:00–20:59 | `tonight` (an evening plan centred on dinner) | today |
   | Fri 21:00–23:59 | `day` | Saturday |
   | Sat 00:00–15:59 | `day` | Saturday (today) |
   | Sat 21:00–23:59 | `day` | Sunday |
   | Sun 00:00–15:59 | `day` | Sunday (today) |
   | Sun 21:00–23:59 | `weekend` | the coming Saturday |
   | Mon 00:00 to Thu 23:59, and Fri 00:00–15:59 | `weekend` | the coming Saturday |

   The rows cover every minute of the week exactly once.
3. Timing follows the kind ◇. `tonight`: the first beat starts at least 30 minutes after the
   moment, rounded up to the next quarter hour, and not before 17:30; the meal beat starts no
   earlier than 19:00 and no later than 22:00, and comes first when the moment is late.
   `day`: the first beat starts at the next full hour at least 60 minutes ahead and not before
   10:00 (for a plan dated tomorrow or later, not before 10:00). `weekend`: today's Saturday timing.
4. Each proposal has a **moment key**: the kind plus the calendar date the plan is for (for example
   `tonight:2026-10-09`). The moment key, not the clock, decides what is shown.
5. Opening the app again while the moment key is unchanged shows the same proposal and creates
   nothing new. Show another and Not this create a new proposal under the same key, as they do today.
   A new key creates one new proposal.
6. If a locked plan already covers the moment (`tonight` and `day`: a locked plan dated today;
   `weekend`: a locked plan covering the coming Saturday or Sunday), the home screen shows that
   locked plan and creates no suggestion.
7. The 2026-07-19 decisions still hold for every new proposal: it enters History as `suggested`, and
   the last 100 surfaced plans' named stops are excluded from later proposals. Rule 5 is what keeps
   idle opens from consuming that window.
8. Who the proposal is for ◇: the user's "Last group" if one exists, otherwise the whole household.
   Hard constraints, memory visibility and privacy rules apply exactly as today.
9. **Reason line.** Every proposal shows one line made of parts, each traceable to something the app
   holds: the moment ("Friday evening"), the people (names, or "you and your wife"), one taste or
   hunch that contributed to the winning candidate's score, quoted as stored, and one weather
   clause when a forecast exists for that date. A part with no source is omitted, not guessed. The
   line is assembled by the server from these parts, not written freehand by a model.
10. **Romantic framing.** When the group's people are the owner plus exactly one other person whose
    relationship is a partner word (English: wife, husband, partner, spouse, girlfriend, boyfriend,
    fiancé, fiancée; Portuguese: esposa, marido, namorada, namorado, companheira, companheiro) ◇,
    pets are ignored for this test, and the kind is `tonight`, the request carries a romantic-dinner
    intent and the reason line says "romantic evening". Otherwise the wording is neutral.
11. **Scope switch.** Under every proposal, one tap switches scope to each of the other kinds
    (Tonight, Today, This weekend, Trip) and regenerates with the same group. A visible Customize
    action opens the existing manual setup form, prefilled with the current group and kind.
12. **Loading.** If the proposal already exists it appears with the page. If it must be generated, a
    skeleton with moment-specific text ("Finding your Friday dinner…") appears at once and the
    proposal replaces it. The screen is never blank and never a dead end: if generation fails, the
    existing deterministic fallback or error handling applies and Customize is offered.
13. **Relationship data.** Each person's relationship can be set, edited and cleared in onboarding
    and in Memory, and by telling Buddy ("Dani is my wife"). A Buddy-proposed change is saved only
    after one tap on a confirm chip. A connected friend account keeps a relationship the owner set;
    "PlanBuddy friend" is shown only while it is unset.

### B. Time off (Increment 2)
14. In Memory a **Time off** section lists the user's time-off ranges (label, start date, end date)
    and lets them add, edit and delete one (delete asks for confirmation). Telling Buddy "I'm off
    Dec 24 to 31" proposes the entry as a confirm chip, saved only on one tap.
15. A **trip nudge** exists when a time-off range ends today or later, starts within 183 days ◇, is
    not snoozed, and overlaps no locked plan; the earliest such range is used. It offers two options:
    a local one from the Getaway pipeline and a farther one from the Vacation pipeline, both built
    for the range's dates and the same group.
16. Precedence ◇: (a) a locked plan covering the moment is shown (rule 6). (b) Otherwise, for kind
    `tonight` or `day`, the moment proposal leads and the trip nudge, if it exists, is a smaller
    card below it. (c) For kind `weekend`, the trip nudge leads if it exists, with "Plan this
    weekend" one tap away; otherwise the weekend proposal leads.
17. The nudge's reason line names the dates from the time-off entry and one stored taste, quoted as
    stored. A season-bound taste is cited only when the dates fit its season ◇ (snow, ski, winter:
    December to March; beach, swim: June to September); otherwise the taste is not cited.
18. "Not now" on the nudge hides it for 7 days ◇. The Trip scope option remains available.
19. When no time-off entry exists, nothing on any screen mentions vacation or time off outside
    Memory's empty Time off section.

### C. Model policy
20. Every LLM role in the product (plan drafting on the fast path, trip destination ideas, chat,
    feedback and memory extraction, Buddy action routing, event features) runs on DeepSeek V4 Flash
    with the existing guardrails (reasoning cap, direct-answer retry, schema validation, the
    deterministic quality gate). Another model is used only where DeepSeek lacks the capability
    (Google grounding, images); this feature needs neither.
21. The fast plan-draft role moves off `openai/gpt-4o-mini` only after a measured bar is met: over at
    least 20 requests mixing Lisbon, two other cities and a trip, at least 90% return schema-valid
    output that passes the quality gate and the 95th-percentile time is at most 12 seconds (the
    existing ceiling). If the bar is not met, that one role stays as it is and the numbers go to
    Diogo; nothing is switched silently.
22. Lisbon `tonight`, `day` and `weekend` proposals have no LLM call on their critical path (the
    catalogue planner is deterministic); the bar in rule 21 therefore governs other cities and trips.

## Data
- Device clock: the request carries the device's local date-time. It is used only to resolve the
  moment and is not stored. ◇ The server does not compare it with its own clock, so a browser test
  clock works against production.
- Plan specs gain the moment kind and the moment key; the proposal's start-time rule from rule 3.
  A plan's reason parts are stored with the plan so reopening it shows the same line.
- New `life_dates` table, tenant-scoped like every user table: label, start date, end date, snoozed
  until, timestamps; end is never before start. No other source of time off exists in this unit.
- Participants already have a `relationship` column; no schema change. Friend-account display must
  stop overwriting a set value.
- No new external service, key or provider.

## Interfaces
- Home screen at `/`: the moment proposal, locked plan or trip nudge; scope chips; Customize.
- Moment endpoint: given the device's local date-time, returns the kind, key, reason parts and
  either a ready plan, a locked plan, or a generation job the client follows with the existing job
  lifecycle (it survives tab switches and reloads, as today's generation does).
- Time-off endpoints: list, create, update, delete, snooze (all tenant-scoped, 404 across tenants).
- Existing participant update endpoint is reused for relationship.
- Buddy gains two confirm-before-write actions: set relationship, add time off.
- The existing planning page stays as the Customize target.

## Constraints
- Hosting: Render with Neon, as today. The product runs off Diogo's machines, so the hosted
  exception to the "local LLM = Claude Code CLI" rule applies; DeepSeek V4 Flash was approved by
  Diogo on 2026-10-05. No metered Anthropic API anywhere.
- No fabricated data: nothing is displayed that the app has no record of (rules 9, 17, 19).
- Complete CRUD for every user-entered thing this unit adds: relationship (set, edit, clear) and
  time off (add, edit, delete).
- Background work survives tab switches and reloads (reuses the generation job lifecycle).
- UI language follows the existing English app; mobile-first at 390 px; keyboard operable, visible
  focus, loading state announced to screen readers, contrast per the existing design tokens.
- Out of scope (confirmed by Diogo, in the must-have backlog): calendar import, notifications.

## Acceptance
Each item is a check someone can run. All run against the real build; the live ones against
production after deploy.
1. **Moment table.** Unit tests cover the table in rules 2 and 4 at these device times, each with the
   expected kind and key: Mon 09:00, Wed 14:00, Thu 23:30, Fri 00:00, Fri 06:00, Fri 15:59, Fri
   16:00, Fri 20:59, Fri 21:00, Sat 02:00, Sat 06:00, Sat 11:00, Sat 15:59, Sat 16:00, Sat 20:59,
   Sat 21:00, Sun 02:00, Sun 16:00, Sun 21:00. A test also asserts that every minute of a sample
   week maps to exactly one row.
2. **Timing.** For a Fri 19:00 request the first beat starts 19:30 or later and the meal beat starts
   between 19:00 and 22:00; for Fri 20:59 the meal beat is the first beat; for Sat 11:00 the first
   beat starts at 12:00 or later.
3. **Reuse.** Two requests with the same key return the same plan id and leave exactly one
   `suggested` History row; Show another creates a second under the same key; a new key creates a
   new row.
4. **Locked.** With a locked plan covering the moment, the endpoint returns it and creates no row.
5. **Constraints.** With a stored allergy constraint, a moment proposal never violates it (reuse
   and extend the existing filter tests).
6. **Reason line.** For every proposal in the tests, each reason part carries a reference that
   exists in that user's data; with no tastes stored the line has no taste clause; with no forecast
   it has no weather clause.
7. **Romantic framing.** Owner plus one "wife" plus a dog on a Friday evening → framing present;
   same group with the relationship unset → absent; owner plus two other people → absent;
   friend-account partner with relationship set → preserved after the friends list loads.
8. **Relationship UI.** On a 390 px browser, set, edit and clear a relationship in onboarding and in
   Memory; tell Buddy "Dani is my wife", see the confirm chip, decline once and confirm once.
9. **Time off CRUD.** Add, edit and delete a range in Memory and through a Buddy confirm chip;
   cross-tenant requests return 404.
10. **Nudge.** With a range in the next 183 days and no locked plan: Wed 14:00 → the nudge leads with
    two options (one from each pipeline) and "Plan this weekend" works; Fri 19:00 → the dinner leads
    and the nudge is a smaller card; a locked plan covering the range removes the nudge; "Not now"
    hides it and it returns after 7 days (clock-advanced test). With zero ranges, no screen text
    mentions vacation or time off outside Memory.
11. **Season guard.** A "loves snow" taste is cited for a December range and not for a July range.
12. **Model bar.** A benchmark script runs the rule-21 mix; its numbers go into LOG.md; the default
    changes only if the bar is met, otherwise Diogo is told with the numbers.
13. **Live canary** (production, real browser with a controlled clock): opened at Fri 19:00, Sat
    11:00 and Wed 14:00 on Diogo's real account, the three first screens show three different fitting
    proposals with zero taps; the reuse path is visible within 1 second of load and the fresh path
    within 5 seconds for Lisbon; 390 px has no horizontal overflow; screenshots of all three are
    inspected (visual-verify) before the push counts as done.
14. **Regression.** The existing 162 tests, typecheck, lint, production build and both mobile
    Playwright journeys stay green; new tests are added for items 1–11.

## Risks
- **Wrong or odd device clock.** The proposal fits whatever the device says; accepted, because the
  moment is the user's own and affects only them.
- **Novelty burn from idle opens.** Handled by the moment key (rules 4–5, acceptance 3).
- **Late "tonight" moments need the meal first.** Today's planner is a fixed three-beat shape; the
  build must allow a meal-first order for late evenings without breaking the other kinds.
- **Relationship vocabulary misses a word.** The framing stays neutral rather than guessing; the list
  can grow.
- **DeepSeek too slow or malformed for the fast role.** Measured bar before any switch (rule 21); the
  deterministic fallback already protects the user either way.
- **Trip ideas overclaim.** No prices, flights or availability anywhere; the reason line is
  assembled from stored facts; destination validation reuses what Vacation already does.
- **Time-off needs manual entry,** which cuts against "passive information". Accepted for now by
  Diogo; the calendar import in the must-have backlog removes it.
- **Season table is crude** (northern hemisphere, two tastes). It only decides whether a taste is
  cited, never whether a plan is allowed.
- **First open with an empty household or no tastes.** Onboarding still runs first; with no tastes
  the reason line carries only the moment and the people.

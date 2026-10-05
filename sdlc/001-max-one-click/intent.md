# Intent: Max 1-click life — PlanBuddy opens on the answer
Date: 2026-10-05 · Project: PlanBuddy · Status: draft (rev 2, after a FAIL review)

Items marked ◇ are Claude's additions, not Diogo's words. He can strike any of them.

## Problem
PlanBuddy's first screen is a setup form: choose Day off / Weekend / Getaway / Vacation, confirm
dates (defaulted to next Saturday), see who is preselected, optionally open "Plan controls", then
press "Plan my weekend". That is several decisions before any value, and most are things the app
could know: who is in the household, their tastes and learned hunches, the home base, the weather,
what was already planned. In planning it uses only the date: it has no time-of-day or time-zone
awareness and no concept of the person's time off.

Diogo's goal is **"max 1 click life"**: the app knows what it needs to solve a life decision (here:
what to do tonight, this afternoon, this weekend, or on vacation) from context — dates, day of the
week, time of day, who, what they love — and answers with one click or less. The proposal should
already be on screen when the app opens.

His two examples (his words, condensed):
1. Opened at 19:00 on a Friday: "It's 19h on a Friday — I recommend this restaurant for a romantic
   evening with your wife. If you'd rather plan the weekend, let me know."
2. Opened on a Wednesday during work: "You have vacation scheduled for the last week of the year and
   still no plans. Last time you told me your wife loves snow and Sissi — what about a trip to
   Vienna, or Serra da Estrela if you prefer to stay local?"

## Who it is for
Diogo and his household, as an end user of PlanBuddy.

## Standing decisions that apply
- Model policy (Diogo, 2026-10-05): every LLM role runs on DeepSeek V4 Flash with guardrails; another
  model only for a capability DeepSeek lacks (Google grounding, images). This supersedes the
  2026-07-22 STATE.md decision that `openai/gpt-4o-mini` drafts plans. ◇ Latency is a known risk
  (DeepSeek missed the 12-second plan deadline in July), so the switch must be measured, not assumed.
- All existing STATE.md decisions on hard constraints, memory visibility, privacy and sharing hold.

## What "done" looks like
Increment 1 — the moment (no calendar needed)
1. Opening the live app (logged in, onboarding complete) shows a proposal for **this moment** with
   zero taps, no form first. "This moment" is the device's local time and time zone. On Diogo's
   account, opened on a Friday at 19:00, a Saturday at 11:00 and a Wednesday at 14:00, it shows
   visibly different proposals that fit those moments (Friday evening → a dinner; ◇ Saturday 11:00 →
   an afternoon plan; ◇ Wednesday daytime → the coming weekend).
2. Every proposal says in one line why it is shown now: the moment, who it is for, and what it drew
   on (e.g. "Friday evening · you and your wife · she loves …"). ◇ Every fact in that line can be found
   in the app: the household, Memory, History or the saved dates.
3. "Romantic evening with your wife" works from data the app can hold: each person's relationship
   (wife, husband, partner, …) can be set and edited in the app, in onboarding, in Memory, and by
   telling Buddy. ◇ The romantic framing appears only when the selected group is the owner plus a
   partner and that relationship has been set.
4. From the proposal, one tap locks it, one tap shows another, and one clearly visible tap switches
   scope ("plan the weekend instead"). ◇ Not this, tweak, reactions and Buddy keep working from the
   proposal as they do today.
5. ◇ Opening the app repeatedly does not pile up History entries or use up the novelty window: the
   same proposal is shown until the moment changes or Diogo asks for another.
6. ◇ If a plan is already locked for the current moment, opening the app shows that plan instead of a
   new suggestion.
7. ◇ The existing manual setup form stays one tap away for anyone who wants to choose themselves.

Increment 2 — time off (Diogo's second example; ◇ the split into two increments is Claude's)
8. ◇ Diogo can add, edit and delete time-off dates (a label and a date range) in the app, and tell Buddy
   about them in chat.
9. With a future time-off range and no locked plan covering it, opening the app proposes a trip that
   names those dates and a remembered taste: one farther destination and one local option, as in his
   Vienna / Serra da Estrela example. ◇ When no time-off dates exist, vacation is never mentioned.

## Explicitly out of scope
- Notifications, push or email when the app is closed (the "less than one click" end state). ◇ Diogo
  to confirm this waits.
- Booking, payment, flight or hotel prices or availability.
- Importing time off from a calendar (private calendar link or Google login). ◇ Deliberately later:
  it would make "the app knows" stronger than manual entry, and Diogo may pull it forward.
- A restaurant catalogue for cities other than Lisbon; trips stay at destination level, as Getaway
  and Vacation already are, not full itineraries.
- Any change to hard-constraint, memory, friend-sharing or privacy rules.
- A visual redesign of anything except the opening screen and the small relationship and time-off
  editors it needs.

## Open questions
1. Calendar import: manual entry first (default taken). Does Diogo want a private calendar link
   or Google login pulled into a later increment? Not blocking: increments 1 and 2 need neither.

---
## Review
Verdict: PASS WITH NOTES
Reviewer: intent reviewer 2 · model sonnet · 2026-10-05 (first pass, same day: FAIL — DeepSeek policy missing, relationship not settable, invented facts, unlabelled additions; all fixed in rev 2)
Findings carried into spec.md (not dropped):
- ◇ marking gaps (Wednesday→weekend, time-off mechanism, "never mentioned", two increments): fixed in this file.
- Precedence between the moment proposal and a trip nudge is undefined: the spec must define it.
- "Moment" has no granularity (items 5, 6, 9): the spec must fix buckets and a moment key.
- History/novelty: the 2026-07-19 decisions (every surfaced winner enters History as `suggested`; novelty excludes recent plans) are not mentioned: the spec must say they still apply to each new proposal.
- Item 3: pets must not break "owner plus a partner"; a connected friend account's relationship is overwritten by the "PlanBuddy friend" default (friends/repo.ts:76): the spec must handle both.
- Model policy has no measurable bar and "done" has no loading/latency obligation: the spec must define both.

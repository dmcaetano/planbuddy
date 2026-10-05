# Intent: Max 1-click life — PlanBuddy opens on the answer
Date: 2026-10-05 · Project: PlanBuddy · Status: draft

## Problem
PlanBuddy's first screen is a setup form: pick Day off / Weekend / Getaway / Vacation, confirm
dates (defaulted to next Saturday), tick who is coming, optionally open Advanced, then press
"Plan my weekend". That is several decisions before any value, and almost every one is something
the app already knows: who is in the household (including each person's relationship, e.g. wife,
and the dog), their tastes and learned hunches, the home base, the weather, and what was already
planned. What it has never known is the clock and the calendar of the person's life.

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
Diogo and his household first (his wife and their dog) as an end user of PlanBuddy. The behaviour is
the same for any later account.

## What "done" looks like
1. Opening the live app, logged in with onboarding complete, shows a proposal for **this moment**
   with zero taps — no form first. On Diogo's account the same app opened at Friday 19:00, Saturday
   11:00 and Wednesday 14:00 shows three visibly different, fitting proposals.
2. Every proposal says in one line why it is being shown now: the moment, who it is for, and what
   it drew on (e.g. "Friday evening · you and your wife · she loves …"). It never states context the
   app does not actually have.
3. From the proposal, one tap locks it, one tap shows another, and one clearly visible tap
   switches scope ("plan the weekend instead"). Not this, tweak, reactions and Buddy keep working
   from the proposal exactly as they do on today's plan screen.
4. When the app holds future dates marked as time off and no locked plan covers them, opening it
   proposes a trip — one farther option and one nearby option — that names those dates and a
   remembered taste. When the app has no such dates it never mentions vacation.
5. If a plan is already locked for the current moment, opening the app shows that plan instead of a
   fresh suggestion.
6. The existing manual setup form is still one tap away for anyone who wants to choose themselves.

## Explicitly out of scope
- Notifications, push or email when the app is closed (the "less than one click" end state). Later.
- Booking, payment, flight or hotel prices or availability.
- Google OAuth calendar connection (the "Calendar connection" item in STATE.md's future ideas).
- A restaurant catalogue for cities other than Lisbon; trip proposals stay at destination-anchor
  level, as Getaway/Vacation already are, not full itineraries.
- Any change to hard-constraint, memory, friend-sharing or privacy rules. Proposals obey them as is.
- A visual redesign of anything except the opening screen.

## Open questions
1. How does the app learn that dates are time off? Default taken: Diogo declares them once (in Buddy
   chat or a small, fully editable and deletable "life dates" list); a private iCal link as an
   optional import comes after that. This does not block the first increment — time- and
   day-aware dinner / afternoon / weekend proposals — which needs no calendar at all.

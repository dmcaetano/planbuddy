# PlanBuddy

One confident, personalized plan for a day off, weekend, getaway, or vacation.

- Live app: https://planbuddy.onrender.com
- Product contract: [PRODUCT-CONTRACT.md](./PRODUCT-CONTRACT.md)
- Architecture and behavior: [DESCRIPTION.md](./DESCRIPTION.md)
- QA evidence: [QA-REPORT.md](./QA-REPORT.md)

PlanBuddy remembers household members and pets, treats allergies and other
hard constraints as vetoes, grounds each itinerary with Google Search through
Gemini, then uses deterministic server-side filtering and least-misery scoring
to choose the winner. Every result includes real named stops, Google Maps
routes, attributed Commons imagery, distances, live weather, clothing and pet
preparation, operational checks, and a compact fallback. DeepSeek V4 Flash
powers memory chat, plan actions, and Love feature learning. Users can make
reversible one-detail edits, connect friends for private group planning, and
share scrubbed itineraries through expiring private links.
Every surfaced recommendation is saved in History before the user chooses it,
so it can be reopened, rated, shared, or locked later. Recent titles and named
venues are fed back into discovery and deterministic novelty scoring to prevent
the same outing from returning under a different title.

## Local development

```bash
npm install
npm run dev
```

No external services are required locally: PGlite and a deterministic demo AI
are used when `DATABASE_URL`, `OPENROUTER_API_KEY`, and `GEMINI_API_KEY` are absent. See
[.env.example](./.env.example) for production-style configuration.

# PlanBuddy

One confident, personalized plan for a day off, weekend, getaway, or vacation.

- Live app: https://planbuddy.onrender.com
- Product contract: [PRODUCT-CONTRACT.md](./PRODUCT-CONTRACT.md)
- Architecture and behavior: [DESCRIPTION.md](./DESCRIPTION.md)
- QA evidence: [QA-REPORT.md](./QA-REPORT.md)

PlanBuddy remembers household members and pets, treats allergies and other
hard constraints as vetoes, proposes plans with DeepSeek V4 Flash, then uses
deterministic server-side filtering and least-misery scoring to choose the
winner. Explicit rejection and post-plan feedback feed a visible, guarded
self-improvement loop.

## Local development

```bash
npm install
npm run dev
```

No external services are required locally: PGlite and a deterministic demo AI
are used when `DATABASE_URL` and `OPENROUTER_API_KEY` are absent. See
[.env.example](./.env.example) for production-style configuration.

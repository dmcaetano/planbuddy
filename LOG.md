# PlanBuddy — Log

## 2026-07-19 — Project start

### What we did
Named the product PlanBuddy, evaluated whether weekend/travel/vacation should be separate, and converged on one product. Ran three Codex–Fable discussion iterations under the Avengers workflow and froze the v1 contract.

### What we decided
The product’s moat is trusted, inspectable household memory; its magic is a single confident recommendation. Safety constraints are mechanically grounded and deterministic server logic controls filtering and ranking. The MVP includes full chat, memory, history, feedback learning, Render, Neon, and DeepSeek.

### What did not work
Foreground Claude CLI transport hung; background Claude sessions worked. The first background round attempted a broad scan, so subsequent discussion sessions explicitly denied tools and returned clean reasoning-only memos.

### Next
Implement, test, deploy, and verify the live application.

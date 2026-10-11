import { describe, expect, it, beforeAll } from "vitest";
import { getTestWorkerApp, WorkerAgent } from "../helpers/testWorkerApp.js";
import { signBody } from "../../src/server/omni/hub.js";
import { saveLink } from "../../src/server/omni/repo.js";
import { createUser } from "../../src/server/users/repo.js";
import { seedOwnerParticipant } from "../../src/server/participants/repo.js";
import { hashPassword } from "../../src/server/auth/passwords.js";

const KEY = "worker-test-signing-key";

describe("worker: Buddy Contract (phase 6)", () => {
  let worker: Awaited<ReturnType<typeof getTestWorkerApp>>;
  let userId: string;
  const linkId = "worker-test-link";

  beforeAll(async () => {
    worker = await getTestWorkerApp();
    const user = await createUser("worker-buddy@example.com", await hashPassword("password123"));
    userId = user.id;
    await seedOwnerParticipant(userId);
    await saveLink({ userId, linkId, hubToken: "hub-token", signingKey: KEY, hubUrl: "https://hub.example.com" });
  });

  it("GET /api/buddy/health is open and reports the contract version", async () => {
    const agent = new WorkerAgent(worker);
    const res = await agent.get("/api/buddy/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, contract: 1, app: "planbuddy" });
  });

  it("unsigned GET /card and POST /act both 401 with 'bad signature'", async () => {
    const agent = new WorkerAgent(worker);
    const card = await agent.get("/api/buddy/card");
    expect(card.status).toBe(401);
    expect(card.body).toEqual({ error: "bad signature" });

    const act = await agent.post("/api/buddy/act", { action: "primary" });
    expect(act.status).toBe(401);
    expect(act.body).toEqual({ error: "bad signature" });
  });

  it("a correctly-signed GET /card succeeds, and a correctly-signed POST /act is replay-protected", async () => {
    const agent = new WorkerAgent(worker);
    const ts = String(Date.now());
    const cardSig = signBody(KEY, ts, "");
    const card = await agent.get("/api/buddy/card", {
      "X-Omni-Link": linkId,
      "X-Omni-Timestamp": ts,
      "X-Omni-Signature": cardSig,
    });
    expect(card.status).toBe(200);

    const actBody = { action: "primary", actionId: "view_plan" };
    const actTs = String(Date.now());
    const raw = JSON.stringify(actBody);
    const actSig = signBody(KEY, actTs, raw);
    const headers = { "X-Omni-Link": linkId, "X-Omni-Timestamp": actTs, "X-Omni-Signature": actSig };

    const first = await agent.post("/api/buddy/act", actBody, headers);
    expect(first.status).toBe(200);
    expect((first.body as { ok: boolean }).ok).toBe(true);

    const replay = await agent.post("/api/buddy/act", actBody, headers);
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: "request already used" });
  });
});

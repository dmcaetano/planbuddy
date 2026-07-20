import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";

const HDR = "X-PlanBuddy-Client";

async function account(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const signup = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  await agent.put("/api/auth/home-base").set(HDR, "1").send({ label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 });
  return { agent, userId: signup.body.user.id as string };
}

async function sendInvite(inviter: { agent: request.SuperAgentTest }) {
  const invite = await inviter.agent.post("/api/friends/invites").set(HDR, "1");
  return invite.body.invite.token as string;
}

describe("friend blocking", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("blocking ends an active friendship and appears in the blocker's blocked list", async () => {
    const alice = await account(app, "block-alice@example.com");
    const bob = await account(app, "block-bob@example.com");

    const token = await sendInvite(alice);
    await bob.agent.post(`/api/friends/invites/${token}/accept`).set(HDR, "1");
    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(1);

    const block = await alice.agent.post(`/api/friends/${bob.userId}/block`).set(HDR, "1");
    expect(block.status).toBe(204);

    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(0);

    const blockedList = await alice.agent.get("/api/friends/blocked").set(HDR, "1");
    expect(blockedList.status).toBe(200);
    expect(blockedList.body.blocked).toHaveLength(1);
    expect(blockedList.body.blocked[0].userId).toBe(bob.userId);
  });

  it("prevents a blocked pair from reconnecting via invite redemption in either direction, with a neutral error", async () => {
    const alice = await account(app, "block-neutral-alice@example.com");
    const bob = await account(app, "block-neutral-bob@example.com");

    await alice.agent.post(`/api/friends/${bob.userId}/block`).set(HDR, "1");

    // Direction 1: blocker (alice) invites, blocked user (bob) tries to accept.
    const tokenFromAlice = await sendInvite(alice);
    const bobAttempt = await bob.agent.post(`/api/friends/invites/${tokenFromAlice}/accept`).set(HDR, "1");
    expect(bobAttempt.status).toBe(404);

    // Direction 2: blocked user (bob) invites, blocker (alice) tries to accept.
    const tokenFromBob = await sendInvite(bob);
    const aliceAttempt = await alice.agent.post(`/api/friends/invites/${tokenFromBob}/accept`).set(HDR, "1");
    expect(aliceAttempt.status).toBe(404);

    // Same neutral message as any other invalid/expired invite -- no leak that a block is the cause.
    const expired = await alice.agent.post("/api/friends/invites/not-a-real-token-not-a-real-token").set(HDR, "1");
    expect(aliceAttempt.body.error).toBe(expired.body.error);

    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(0);
    expect((await bob.agent.get("/api/friends")).body.friends).toHaveLength(0);
  });

  it("unblock allows a fresh invite to be redeemed again, and restores nothing automatically", async () => {
    const alice = await account(app, "unblock-alice@example.com");
    const bob = await account(app, "unblock-bob@example.com");

    const firstToken = await sendInvite(alice);
    await bob.agent.post(`/api/friends/invites/${firstToken}/accept`).set(HDR, "1");
    await alice.agent.post(`/api/friends/${bob.userId}/block`).set(HDR, "1");
    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(0);

    const unblock = await alice.agent.delete(`/api/friends/${bob.userId}/block`).set(HDR, "1");
    expect(unblock.status).toBe(204);
    expect((await alice.agent.get("/api/friends/blocked")).body.blocked).toHaveLength(0);
    // Unblocking restores nothing by itself.
    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(0);

    const newToken = await sendInvite(alice);
    const accept = await bob.agent.post(`/api/friends/invites/${newToken}/accept`).set(HDR, "1");
    expect(accept.status).toBe(200);
    expect((await alice.agent.get("/api/friends")).body.friends).toHaveLength(1);
  });

  it("a second unblock of a never-blocked user 404s, and self-block is rejected", async () => {
    const alice = await account(app, "block-self-alice@example.com");
    const bob = await account(app, "block-self-bob@example.com");

    const selfBlock = await alice.agent.post(`/api/friends/${alice.userId}/block`).set(HDR, "1");
    expect(selfBlock.status).toBe(404);

    const neverBlockedUnblock = await alice.agent.delete(`/api/friends/${bob.userId}/block`).set(HDR, "1");
    expect(neverBlockedUnblock.status).toBe(404);
  });
});

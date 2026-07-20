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

async function connect(a: { agent: request.SuperAgentTest }, b: { agent: request.SuperAgentTest }) {
  const invite = await a.agent.post("/api/friends/invites").set(HDR, "1");
  const token = invite.body.invite.token as string;
  await b.agent.post(`/api/friends/invites/${token}/accept`).set(HDR, "1");
}

describe("friend circle labels", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("replaces a friend's full label set, allows preset + custom together, and surfaces them on GET /friends", async () => {
    const alice = await account(app, "labels-alice@example.com");
    const bob = await account(app, "labels-bob@example.com");
    await connect(alice, bob);

    const replace = await alice.agent
      .put(`/api/friends/${bob.userId}/labels`)
      .set(HDR, "1")
      .send({ labels: ["Family", "Close friends", "Hiking crew"] });
    expect(replace.status).toBe(200);
    const names = (replace.body.labels as { name: string }[]).map((label) => label.name).sort();
    expect(names).toEqual(["Close friends", "Family", "Hiking crew"]);

    const list = await alice.agent.get("/api/friends").set(HDR, "1");
    const bobEntry = list.body.friends.find((friend: { userId: string }) => friend.userId === bob.userId);
    expect(bobEntry.labels.map((label: { name: string }) => label.name).sort()).toEqual(["Close friends", "Family", "Hiking crew"]);

    // Replacing again with a smaller set drops the removed label.
    const shrink = await alice.agent.put(`/api/friends/${bob.userId}/labels`).set(HDR, "1").send({ labels: ["Family"] });
    expect(shrink.status).toBe(200);
    expect(shrink.body.labels.map((label: { name: string }) => label.name)).toEqual(["Family"]);
  });

  it("rejects a custom label over 24 characters and keeps labels isolated per owning user", async () => {
    const alice = await account(app, "labels-long-alice@example.com");
    const bob = await account(app, "labels-long-bob@example.com");
    const carol = await account(app, "labels-long-carol@example.com");
    await connect(alice, bob);
    await connect(alice, carol);

    const tooLong = await alice.agent
      .put(`/api/friends/${bob.userId}/labels`)
      .set(HDR, "1")
      .send({ labels: ["a".repeat(25)] });
    expect(tooLong.status).toBe(400);

    await alice.agent.put(`/api/friends/${bob.userId}/labels`).set(HDR, "1").send({ labels: ["Family"] });

    // Bob never sees Alice's labels for Bob, even though Bob is the friend being labeled.
    const bobsOwnFriends = await bob.agent.get("/api/friends").set(HDR, "1");
    const aliceFromBob = bobsOwnFriends.body.friends.find((friend: { userId: string }) => friend.userId === alice.userId);
    expect(aliceFromBob.labels).toEqual([]);

    // A user can't label someone who isn't their friend.
    const notFriends = await bob.agent.put(`/api/friends/${carol.userId}/labels`).set(HDR, "1").send({ labels: ["Family"] });
    expect(notFriends.status).toBe(404);
  });

  it("GET /friends/labels returns distinct labels with correct member counts and member ids", async () => {
    const alice = await account(app, "labels-count-alice@example.com");
    const bob = await account(app, "labels-count-bob@example.com");
    const carol = await account(app, "labels-count-carol@example.com");
    await connect(alice, bob);
    await connect(alice, carol);

    await alice.agent.put(`/api/friends/${bob.userId}/labels`).set(HDR, "1").send({ labels: ["Family", "Close friends"] });
    await alice.agent.put(`/api/friends/${carol.userId}/labels`).set(HDR, "1").send({ labels: ["Family"] });

    const summary = await alice.agent.get("/api/friends/labels").set(HDR, "1");
    expect(summary.status).toBe(200);
    const byName = new Map((summary.body.labels as { name: string; memberCount: number; friendUserIds: string[] }[]).map((l) => [l.name, l]));

    expect(byName.get("Family")?.memberCount).toBe(2);
    expect(new Set(byName.get("Family")?.friendUserIds)).toEqual(new Set([bob.userId, carol.userId]));
    expect(byName.get("Close friends")?.memberCount).toBe(1);
    expect(byName.get("Close friends")?.friendUserIds).toEqual([bob.userId]);

    // Another user's labels never appear in this summary.
    const carolSummary = await carol.agent.get("/api/friends/labels").set(HDR, "1");
    expect(carolSummary.body.labels).toEqual([]);
  });

  it("removing or blocking a labeled friend drops them from friendUserIds/memberCount but keeps the label (as the owner's vocabulary) at memberCount 0", async () => {
    const alice = await account(app, "labels-removed-alice@example.com");
    const bob = await account(app, "labels-removed-bob@example.com");
    const carol = await account(app, "labels-removed-carol@example.com");
    await connect(alice, bob);
    await connect(alice, carol);

    await alice.agent.put(`/api/friends/${bob.userId}/labels`).set(HDR, "1").send({ labels: ["Family"] });
    await alice.agent.put(`/api/friends/${carol.userId}/labels`).set(HDR, "1").send({ labels: ["Family"] });

    // Sanity: both are active members before either is removed.
    const before = await alice.agent.get("/api/friends/labels").set(HDR, "1");
    const familyBefore = (before.body.labels as { name: string; memberCount: number; friendUserIds: string[] }[]).find(
      (l) => l.name === "Family"
    )!;
    expect(familyBefore.memberCount).toBe(2);

    // Remove bob as a friend -- he must disappear from the summary's friendUserIds/memberCount even
    // though the friend_label_assignments row for him was never deleted.
    const remove = await alice.agent.delete(`/api/friends/${bob.userId}`).set(HDR, "1");
    expect(remove.status).toBe(204);

    const afterRemove = await alice.agent.get("/api/friends/labels").set(HDR, "1");
    const familyAfterRemove = (afterRemove.body.labels as { name: string; memberCount: number; friendUserIds: string[] }[]).find(
      (l) => l.name === "Family"
    )!;
    expect(familyAfterRemove.memberCount).toBe(1);
    expect(familyAfterRemove.friendUserIds).toEqual([carol.userId]);

    // Now block carol too -- blocking also ends the friendship, so she must drop out as well, but the
    // "Family" label itself (the owner's vocabulary) must still be returned, at memberCount 0.
    const block = await alice.agent.post(`/api/friends/${carol.userId}/block`).set(HDR, "1");
    expect(block.status).toBe(204);

    const afterBlock = await alice.agent.get("/api/friends/labels").set(HDR, "1");
    const familyAfterBlock = (afterBlock.body.labels as { name: string; memberCount: number; friendUserIds: string[] }[]).find(
      (l) => l.name === "Family"
    )!;
    expect(familyAfterBlock.memberCount).toBe(0);
    expect(familyAfterBlock.friendUserIds).toEqual([]);
  });
});

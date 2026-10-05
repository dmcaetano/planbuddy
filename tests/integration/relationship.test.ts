import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";

const HDR = "X-PlanBuddy-Client";

async function signUp(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const res = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  return { agent, userId: res.body.user.id as string };
}

type Agent = Awaited<ReturnType<typeof signUp>>["agent"];

async function addPerson(agent: Agent, name: string, relationship?: string | null, kind = "person") {
  const res = await agent.post("/api/participants").set(HDR, "1").send({ name, kind, relationship });
  expect(res.status).toBe(201);
  return res.body.participant as { id: string; relationship: string | null };
}

async function say(agent: Agent, content: string) {
  const session = await agent.get("/api/chat/session");
  return agent.post(`/api/chat/session/${session.body.session.id}/messages`).set(HDR, "1").send({ content });
}

async function people(agent: Agent) {
  const res = await agent.get("/api/participants");
  return res.body.participants as { id: string; name: string; relationship: string | null; kind: string }[];
}

describe("relationship on participants", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  it("sets, edits and clears a relationship via the update route", async () => {
    const { agent } = await signUp(app, "rel-crud@example.com");
    const dani = await addPerson(agent, "Dani");
    expect(dani.relationship).toBeNull();

    const set = await agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: "wife" });
    expect(set.status).toBe(200);
    expect(set.body.participant.relationship).toBe("wife");

    const edit = await agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: "  partner " });
    expect(edit.body.participant.relationship).toBe("partner");

    const cleared = await agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.participant.relationship).toBeNull();
    expect(cleared.body.participant.name).toBe("Dani");

    await agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: "wife" });
    const blank = await agent.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: "   " });
    expect(blank.body.participant.relationship).toBeNull();
  });

  it("does not let another tenant change a relationship", async () => {
    const { agent: a } = await signUp(app, "rel-ten-a@example.com");
    const { agent: b } = await signUp(app, "rel-ten-b@example.com");
    const dani = await addPerson(a, "Dani", "wife");
    const res = await b.patch(`/api/participants/${dani.id}`).set(HDR, "1").send({ relationship: null });
    expect(res.status).toBe(404);
    expect((await people(a)).find((p) => p.id === dani.id)?.relationship).toBe("wife");
  });
});

describe("Buddy relationship proposals", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  beforeAll(async () => {
    app = await getTestApp();
  });

  it("proposes without writing, then saves only on confirm", async () => {
    const { agent } = await signUp(app, "rel-buddy1@example.com");
    const dani = await addPerson(agent, "Dani");

    const res = await say(agent, "Dani is my wife");
    expect(res.status).toBe(201);
    expect(res.body.relationshipProposal).toMatchObject({ action: "set", participantId: dani.id, relationship: "wife" });
    expect(res.body.assistantMessage.content).toContain("Dani");
    expect((await people(agent)).find((p) => p.id === dani.id)?.relationship).toBeNull();

    const confirm = await agent
      .post("/api/chat/confirm-relationship")
      .set(HDR, "1")
      .send({ participantId: dani.id, name: "Dani", relationship: "wife" });
    expect(confirm.status).toBe(200);
    expect(confirm.body.participant.relationship).toBe("wife");
    expect((await people(agent)).find((p) => p.id === dani.id)?.relationship).toBe("wife");
  });

  it("a declined proposal leaves everything unchanged", async () => {
    const { agent } = await signUp(app, "rel-buddy2@example.com");
    const sissi = await addPerson(agent, "Sissi", "friend");
    const res = await say(agent, "Sissi is my daughter");
    expect(res.body.relationshipProposal).toMatchObject({ action: "set", previousRelationship: "friend", relationship: "daughter" });
    await say(agent, "We love hiking");
    expect((await people(agent)).find((p) => p.id === sissi.id)?.relationship).toBe("friend");
  });

  it("supports the 'my husband is Joao' phrasing and accent-insensitive names", async () => {
    const { agent } = await signUp(app, "rel-buddy3@example.com");
    const p = await addPerson(agent, "João");
    const res = await say(agent, "my husband is Joao");
    expect(res.body.relationshipProposal).toMatchObject({ participantId: p.id, relationship: "husband" });
  });

  it("offers to add an unknown person, and creating happens only on confirm", async () => {
    const { agent } = await signUp(app, "rel-buddy4@example.com");
    const before = (await people(agent)).length;
    const res = await say(agent, "Marta is my esposa");
    expect(res.body.relationshipProposal).toMatchObject({ action: "add", participantId: null, name: "Marta", relationship: "esposa" });
    expect(res.body.assistantMessage.content).toMatch(/have anyone called Marta/);
    expect((await people(agent)).length).toBe(before);

    const confirm = await agent.post("/api/chat/confirm-relationship").set(HDR, "1").send({ name: "Marta", relationship: "esposa" });
    expect(confirm.status).toBe(201);
    expect(confirm.body.created).toBe(true);
    const after = await people(agent);
    expect(after.length).toBe(before + 1);
    expect(after.find((p) => p.name === "Marta")).toMatchObject({ relationship: "esposa", kind: "person" });

    const again = await agent.post("/api/chat/confirm-relationship").set(HDR, "1").send({ name: "marta", relationship: "wife" });
    expect(again.status).toBe(200);
    expect((await people(agent)).length).toBe(before + 1);
  });

  it("does not propose when already saved, or for non-relationship phrases", async () => {
    const { agent } = await signUp(app, "rel-buddy5@example.com");
    await addPerson(agent, "Dani", "wife");
    const same = await say(agent, "Dani is my wife");
    expect(same.body.relationshipProposal).toBeNull();
    expect(same.body.assistantMessage.content).toContain("already");

    const noise = await say(agent, "Dani is my favourite restaurant");
    expect(noise.body.relationshipProposal).toBeNull();
  });

  it("never offers to add someone for a free-word relationship", async () => {
    const { agent } = await signUp(app, "rel-buddy6@example.com");
    const res = await say(agent, "Zed is my landlord");
    expect(res.body.relationshipProposal).toBeNull();
  });

  it("confirm is tenant-scoped, rejects the owner, and validates input", async () => {
    const { agent: a } = await signUp(app, "rel-conf-a@example.com");
    const { agent: b } = await signUp(app, "rel-conf-b@example.com");
    const dani = await addPerson(a, "Dani");

    const cross = await b.post("/api/chat/confirm-relationship").set(HDR, "1").send({ participantId: dani.id, relationship: "wife" });
    expect(cross.status).toBe(404);
    expect((await people(a)).find((p) => p.id === dani.id)?.relationship).toBeNull();

    const owner = (await people(a)).find((p) => p.name === "You")!;
    const own = await a.post("/api/chat/confirm-relationship").set(HDR, "1").send({ participantId: owner.id, relationship: "wife" });
    expect(own.status).toBe(400);

    const bad = await a.post("/api/chat/confirm-relationship").set(HDR, "1").send({ relationship: "wife" });
    expect(bad.status).toBe(400);
  });
});

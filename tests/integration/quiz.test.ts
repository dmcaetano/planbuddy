import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";
import { filterCandidates } from "../../src/server/plans/engine/filter.js";
import type { AiCandidate } from "../../src/shared/schemas.js";

const HDR = "X-PlanBuddy-Client";

async function signUp(app: unknown, email: string) {
  const agent = request.agent(app as never);
  const res = await agent.post("/api/auth/signup").set(HDR, "1").send({ email, password: "password123" });
  return { agent, userId: res.body.user.id as string };
}

function minimalCandidate(overrides: Partial<AiCandidate>): AiCandidate {
  return {
    title: "A day out",
    rationale: "It fits.",
    category: "general",
    indoor: false,
    beats: [{ title: "Beat one", description: "A stop along the way.", category: "general", indoor: false }],
    checkBeforeYouGo: [],
    resolverVenueIds: [],
    citations: [],
    constraintCompliance: [],
    ...overrides,
  };
}

describe("taste quiz integration", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("requires authentication", async () => {
    const res = await request(app as never)
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({ answers: [{ questionId: "days", optionIds: ["nature"] }] });
    expect(res.status).toBe(401);
  });

  it("writes structured tastes and constraints for the owner participant, tagged with quiz provenance", async () => {
    const { agent } = await signUp(app, "quiz1@example.com");
    const participants = await agent.get("/api/participants");
    const owner = participants.body.participants.find((p: { isOwner: boolean }) => p.isOwner);
    expect(owner).toBeTruthy();

    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({
        answers: [
          { questionId: "days", optionIds: ["nature", "food"] },
          { questionId: "energy", optionIds: ["slow"] },
          { questionId: "environment", optionIds: ["either"] }, // "no write" option
          { questionId: "avoid", optionIds: ["peanuts", "stairs"] },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.tastes).toHaveLength(3); // nature, food, slow — "either" writes nothing
    expect(res.body.constraints).toHaveLength(2); // peanuts, stairs

    for (const taste of res.body.tastes) {
      expect(taste.source).toBe("onboarding_quiz");
      expect(taste.participantId).toBe(owner.id);
      expect(taste.polarity).toBe("love");
    }
    for (const constraint of res.body.constraints) {
      expect(constraint.source).toBe("onboarding_quiz");
      expect(constraint.status).toBe("verified");
      expect(constraint.participantId).toBe(owner.id);
    }

    const tastesList = await agent.get("/api/tastes");
    const quizTastes = tastesList.body.tastes.filter((t: { source: string }) => t.source === "onboarding_quiz");
    expect(quizTastes).toHaveLength(3);
    expect(quizTastes.map((t: { text: string }) => t.text)).toEqual(
      expect.arrayContaining([
        "nature parks trails scenic",
        "food markets restaurants tasting",
        "quiet relaxed unhurried",
      ])
    );

    const constraintsList = await agent.get("/api/constraints");
    const quizConstraints = constraintsList.body.constraints.filter(
      (c: { source: string }) => c.source === "onboarding_quiz"
    );
    expect(quizConstraints).toHaveLength(2);
    expect(quizConstraints.map((c: { text: string }) => c.text)).toEqual(
      expect.arrayContaining(["Peanut and tree-nut allergy", "No stairs; step-free access required"])
    );
  });

  it("does not write anything for questions left as 'Not sure' / empty", async () => {
    const { agent } = await signUp(app, "quiz2@example.com");
    const res = await agent.post("/api/tastes/quiz").set(HDR, "1").send({ answers: [] });
    expect(res.status).toBe(201);
    expect(res.body.tastes).toHaveLength(0);
    expect(res.body.constraints).toHaveLength(0);
  });

  it("a retake replaces previous quiz-sourced tastes/constraints instead of duplicating them", async () => {
    const { agent } = await signUp(app, "quiz3@example.com");

    const first = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({
        answers: [
          { questionId: "days", optionIds: ["nature"] },
          { questionId: "avoid", optionIds: ["shellfish"] },
        ],
      });
    expect(first.status).toBe(201);

    // A manually-typed taste and constraint should survive the retake untouched.
    const manualTaste = await agent.post("/api/tastes").set(HDR, "1").send({ text: "loves jazz", polarity: "love" });
    const manualConstraint = await agent.post("/api/constraints").set(HDR, "1").send({ text: "No smoking" });

    const second = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({
        answers: [
          { questionId: "days", optionIds: ["arts"] },
          { questionId: "avoid", optionIds: ["gluten"] },
        ],
      });
    expect(second.status).toBe(201);

    const tastesList = await agent.get("/api/tastes");
    const quizTastes = tastesList.body.tastes.filter((t: { source: string }) => t.source === "onboarding_quiz");
    expect(quizTastes).toHaveLength(1);
    expect(quizTastes[0].text).toBe("culture museum historic learning");

    const constraintsList = await agent.get("/api/constraints");
    const quizConstraints = constraintsList.body.constraints.filter(
      (c: { source: string }) => c.source === "onboarding_quiz"
    );
    expect(quizConstraints).toHaveLength(1);
    expect(quizConstraints[0].text).toBe("Celiac; gluten-free only");

    // Manual entries were untouched by the retake.
    expect(tastesList.body.tastes.some((t: { id: string }) => t.id === manualTaste.body.taste.id)).toBe(true);
    expect(
      constraintsList.body.constraints.some((c: { id: string }) => c.id === manualConstraint.body.constraint.id)
    ).toBe(true);
  });

  it("rejects a payload that answers the same question twice (row amplification via duplicate questions)", async () => {
    const { agent } = await signUp(app, "quiz-dup-question@example.com");
    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({
        answers: [
          { questionId: "days", optionIds: ["nature"] },
          { questionId: "days", optionIds: ["food"] },
        ],
      });
    expect(res.status).toBe(400);

    // Nothing was written -- the whole submission was rejected, not partially applied.
    const tastesList = await agent.get("/api/tastes");
    expect(tastesList.body.tastes.filter((t: { source: string }) => t.source === "onboarding_quiz")).toHaveLength(0);
  });

  it("rejects a single-select question answered with more than one option", async () => {
    const { agent } = await signUp(app, "quiz-over-single@example.com");
    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({ answers: [{ questionId: "energy", optionIds: ["slow", "full"] }] });
    expect(res.status).toBe(400);
  });

  it("rejects a multi-select question over its declared maxSelect (e.g. 'days' allows at most 3)", async () => {
    const { agent } = await signUp(app, "quiz-over-max@example.com");
    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({ answers: [{ questionId: "days", optionIds: ["nature", "food", "arts", "active"] }] });
    expect(res.status).toBe(400);
  });

  it("allows a select-all-that-apply question ('avoid', no maxSelect) up to its full option count", async () => {
    const { agent } = await signUp(app, "quiz-select-all@example.com");
    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({
        answers: [
          {
            questionId: "avoid",
            optionIds: ["peanuts", "shellfish", "dairy", "gluten", "alcohol", "stairs", "noise", "none"],
          },
        ],
      });
    expect(res.status).toBe(201);
  });

  it("legitimate quiz submissions (one answer per question, within each question's own select limit) still pass", async () => {
    const { agent } = await signUp(app, "quiz-legit@example.com");
    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({
        answers: [
          { questionId: "days", optionIds: ["nature", "food", "arts"] }, // exactly at maxSelect (3)
          { questionId: "energy", optionIds: ["slow"] }, // exactly at single-select limit (1)
          { questionId: "avoid", optionIds: ["peanuts", "shellfish"] }, // select-all, under full count
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.tastes.length).toBeGreaterThan(0);
    expect(res.body.constraints).toHaveLength(2);
  });

  it("allergy answers create real constraints that the existing constraint filter respects", async () => {
    const { agent } = await signUp(app, "quiz4@example.com");
    const res = await agent
      .post("/api/tastes/quiz")
      .set(HDR, "1")
      .send({ answers: [{ questionId: "avoid", optionIds: ["peanuts"] }] });
    const constraint = res.body.constraints[0];
    expect(constraint.text).toBe("Peanut and tree-nut allergy");

    const unsafeCandidate = minimalCandidate({
      title: "Peanut butter tasting tour",
      rationale: "A tour through the city's best peanut butter shops.",
    });
    const safeCandidate = minimalCandidate({ title: "Sunset walk by the river" });

    const result = filterCandidates([unsafeCandidate, safeCandidate], {
      activeConstraints: [{ id: constraint.id, text: constraint.text }],
      knownFacts: new Map(),
      resolverMode: "inspiration",
      radiusKm: 20,
      isTripScale: false,
    });

    expect(result.kept.map((c) => c.title)).toEqual(["Sunset walk by the river"]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("constraint violation");
  });
});

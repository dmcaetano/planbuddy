import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/testApp.js";

const HDR = "X-PlanBuddy-Client";

describe("auth integration", () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it("signs up, reports the session via /me, and logs out", async () => {
    const agent = request.agent(app);
    const signup = await agent
      .post("/api/auth/signup")
      .set(HDR, "1")
      .send({ email: "auth1@example.com", password: "password123" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe("auth1@example.com");

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("auth1@example.com");

    const logout = await agent.post("/api/auth/logout").set(HDR, "1");
    expect(logout.status).toBe(204);

    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("rejects duplicate signups with 409", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").set(HDR, "1").send({ email: "dupe@example.com", password: "password123" });
    const second = await agent
      .post("/api/auth/signup")
      .set(HDR, "1")
      .send({ email: "dupe@example.com", password: "password123" });
    expect(second.status).toBe(409);
  });

  it("rejects login with a wrong password", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").set(HDR, "1").send({ email: "wrongpw@example.com", password: "password123" });
    await agent.post("/api/auth/logout").set(HDR, "1");
    const login = await agent
      .post("/api/auth/login")
      .set(HDR, "1")
      .send({ email: "wrongpw@example.com", password: "not-the-password" });
    expect(login.status).toBe(401);
  });

  it("rejects a signup body that fails validation", async () => {
    const res = await request(app).post("/api/auth/signup").set(HDR, "1").send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
  });

  it("blocks mutation requests missing the same-origin header", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email: "noheader@example.com", password: "password123" });
    expect(res.status).toBe(403);
  });

  it("requires authentication for a protected route", async () => {
    const res = await request(app).get("/api/participants");
    expect(res.status).toBe(401);
  });
});

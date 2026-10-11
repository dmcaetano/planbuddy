import { Hono } from "hono";
import { loginSchema, signupSchema, homeBaseSchema, travelPreferencesSchema } from "../shared/schemas.js";
import { createUser, getUserByEmail, setHomeBase, setTravelPreferences } from "../server/users/repo.js";
import { hashPassword, verifyPassword } from "../server/auth/passwords.js";
import { createSession, destroySession, SESSION_COOKIE } from "../server/auth/session.js";
import { setSignedCookie, clearSignedCookie, readSignedCookie } from "./cookies.js";
import { requireAuth } from "./middleware.js";
import { authRateLimiter } from "./rateLimit.js";
import { seedOwnerParticipant } from "../server/participants/repo.js";
import { env, isProduction } from "../server/env.js";

export const authRouter = new Hono();

async function setSessionCookie(c: import("hono").Context, token: string, expiresAt: Date) {
  await setSignedCookie(c, SESSION_COOKIE, token, env.SESSION_SECRET, { expires: expiresAt, secure: isProduction });
}

authRouter.post("/signup", authRateLimiter, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }
  const { email, password } = parsed.data;
  const existing = await getUserByEmail(email);
  if (existing) {
    return c.json({ error: "An account with that email already exists" }, 409);
  }
  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash);
  await seedOwnerParticipant(user.id);
  const { token, expiresAt } = await createSession(user.id);
  await setSessionCookie(c, token, expiresAt);
  return c.json({ user }, 201);
});

authRouter.post("/login", authRateLimiter, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }
  const { email, password } = parsed.data;
  const existing = await getUserByEmail(email);
  if (!existing) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const ok = await verifyPassword(password, existing.passwordHash);
  if (!ok) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const { token, expiresAt } = await createSession(existing.id);
  await setSessionCookie(c, token, expiresAt);
  const { passwordHash: _drop, ...user } = existing;
  return c.json({ user });
});

authRouter.post("/logout", async (c) => {
  const token = await readSignedCookie(c, SESSION_COOKIE, env.SESSION_SECRET);
  if (token) {
    await destroySession(token);
  }
  clearSignedCookie(c, SESSION_COOKIE);
  return c.body(null, 204);
});

authRouter.get("/me", (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  return c.json({ user });
});

authRouter.put("/home-base", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = homeBaseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }
  const { label, lat, lng } = parsed.data;
  const user = await setHomeBase(c.get("user")!.id, label, lat, lng);
  return c.json({ user });
});

authRouter.put("/travel-preferences", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = travelPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }
  const { travelDayKm, travelWeekendKm } = parsed.data;
  const user = await setTravelPreferences(c.get("user")!.id, travelDayKm, travelWeekendKm);
  return c.json({ user });
});

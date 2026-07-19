import { Router } from "express";
import { asyncHandler, validateBody } from "../http.js";
import { loginSchema, signupSchema, homeBaseSchema } from "../../shared/schemas.js";
import { createUser, getUserByEmail, setHomeBase } from "../users/repo.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { clearSessionCookie, createSession, destroySession, setSessionCookie } from "./session.js";
import { requireAuth } from "./middleware.js";
import { authRateLimiter } from "../rateLimit.js";
import { seedOwnerParticipant } from "../participants/repo.js";

export const authRouter = Router();

authRouter.post(
  "/signup",
  authRateLimiter,
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const existing = await getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);
    await seedOwnerParticipant(user.id);
    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user });
  })
);

authRouter.post(
  "/login",
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const existing = await getUserByEmail(email);
    if (!existing) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const ok = await verifyPassword(password, existing.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const { token, expiresAt } = await createSession(existing.id);
    setSessionCookie(res, token, expiresAt);
    const { passwordHash: _drop, ...user } = existing;
    res.json({ user });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await destroySession(req.sessionToken);
    }
    clearSessionCookie(res);
    res.status(204).end();
  })
);

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: req.user });
});

authRouter.put(
  "/home-base",
  requireAuth,
  validateBody(homeBaseSchema),
  asyncHandler(async (req, res) => {
    const { label, lat, lng } = req.body as { label: string; lat: number; lng: number };
    const user = await setHomeBase(req.user!.id, label, lat, lng);
    res.json({ user });
  })
);

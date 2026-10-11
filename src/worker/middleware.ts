import type { Context, Next } from "hono";
import { readSignedCookie } from "./cookies.js";
import { SESSION_COOKIE, findSession } from "../server/auth/session.js";
import { getUserById } from "../server/users/repo.js";
import { env, isProduction } from "../server/env.js";
import type { PublicUser } from "../shared/types.js";

declare module "hono" {
  interface ContextVariableMap {
    user?: PublicUser;
    sessionToken?: string;
  }
}

export async function attachUser(c: Context, next: Next): Promise<void> {
  const token = await readSignedCookie(c, SESSION_COOKIE, env.SESSION_SECRET);
  if (token) {
    const session = await findSession(token);
    if (session) {
      const user = await getUserById(session.user_id);
      if (user) {
        c.set("user", user);
        c.set("sessionToken", token);
      }
    }
  }
  await next();
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  if (!c.get("user")) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  await next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CUSTOM_HEADER = "x-planbuddy-client";

export async function requireSameOrigin(c: Context, next: Next): Promise<Response | void> {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  if (c.req.header(CUSTOM_HEADER) !== "1") {
    return c.json({ error: "Cross-origin mutation blocked" }, 403);
  }
  if (isProduction) {
    const origin = c.req.header("origin");
    const url = new URL(c.req.url);
    const expectedOrigin = `${url.protocol}//${url.host}`;
    if (origin && origin !== expectedOrigin) {
      return c.json({ error: "Cross-origin mutation blocked" }, 403);
    }
  }
  await next();
}

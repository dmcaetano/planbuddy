import type { NextFunction, Request, Response } from "express";
import { findSession, readSessionToken } from "./session.js";
import { getUserById } from "../users/repo.js";
import type { PublicUser } from "../../shared/types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
      sessionToken?: string;
    }
  }
}

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  if (!token) {
    next();
    return;
  }
  const session = await findSession(token);
  if (!session) {
    next();
    return;
  }
  const user = await getUserById(session.user_id);
  if (user) {
    req.user = user;
    req.sessionToken = token;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CUSTOM_HEADER = "x-planbuddy-client";

/**
 * Requires state-changing requests to carry a custom header the client
 * fetch wrapper always sets. Plain cross-site form posts and simple CSRF
 * payloads cannot set custom headers on a cross-origin request without
 * tripping CORS, so this blocks them without a stateful CSRF token.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.get(CUSTOM_HEADER) !== "1") {
    res.status(403).json({ error: "Cross-origin mutation blocked" });
    return;
  }
  next();
}

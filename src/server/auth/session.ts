import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { getDb } from "../db/client.js";
import { isProduction } from "../env.js";

export const SESSION_COOKIE = "pb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: string;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    userId,
    expiresAt.toISOString(),
  ]);
  return { token, expiresAt };
}

export async function findSession(token: string): Promise<SessionRow | null> {
  const db = await getDb();
  const { rows } = await db.query<SessionRow>(
    "SELECT token, user_id, expires_at FROM sessions WHERE token = $1",
    [token]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.query("DELETE FROM sessions WHERE token = $1", [token]);
    return null;
  }
  return row;
}

export async function destroySession(token: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    signed: true,
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function readSessionToken(req: Request): string | null {
  const value = req.signedCookies?.[SESSION_COOKIE];
  return typeof value === "string" ? value : null;
}

// Buddy Contract v1 (OmniBuddy hub) on Hono. Ported LAST (phase 6, most
// security-sensitive) and deliberately reuses every crypto/business-logic
// function from src/server/omni/{hub,repo,card,suggest}.ts UNCHANGED — none
// of them import express, and the crypto they use (node:crypto
// createHmac/createCipheriv/createDecipheriv "aes-256-gcm"/randomBytes/
// timingSafeEqual/hkdfSync) is the same node:crypto surface already
// live-verified working under nodejs_compat (session.ts's randomBytes,
// proven by every signup in phases 2-4). So unlike the original plan.md
// risk ("HMAC/AES via Web Crypto, pattern proven byte-identical to
// node:crypto") no Web Crypto reimplementation was needed: the exact same
// node:crypto-based signing/sealing code runs here as on Render, signing
// and encrypting identically, so links already issued by OmniBuddy keep
// validating against the same stored secrets with zero format change.
import { Hono } from "hono";
import packageJson from "../../package.json" with { type: "json" };
import { logger } from "../server/logger.js";
import { createTaste, deleteTaste } from "../server/memory/tastes.repo.js";
import { buildCard, lockCurrentPlan, unlockPlan, type Loc } from "../server/omni/card.js";
import {
  CONTRACT_VERSION,
  WANTS_PREFIX,
  completeLink,
  connectKey,
  hubBase,
  sanitizeHubText,
  syncToHub,
  verifySignature,
} from "../server/omni/hub.js";
import {
  claimSignature,
  claimUndo,
  clearConnectLoginFailures,
  countBadSignature,
  createUndo,
  deleteLink,
  getConnectLoginFailures,
  getLinkById,
  getLinkForUser,
  recordConnectLoginFailure,
  saveLink,
  type OmniLink,
} from "../server/omni/repo.js";
import { createHubVerifiedUser, getUserByEmail, getUserForConnect } from "../server/users/repo.js";
import { hashPassword, verifyPassword } from "../server/auth/passwords.js";
import { seedOwnerParticipant } from "../server/participants/repo.js";
import { suggestFor } from "../server/omni/suggest.js";
import { attachUser, requireAuth, requireSameOrigin } from "./middleware.js";
import { omniLinkRateLimiter } from "./rateLimit.js";
import type { WorkerBindings } from "./bindings.js";

const VERSION = String(packageJson.version ?? "unknown");
const SKEW_MS = 5 * 60_000;
const BAD_LIMIT = 60;
const BAD_WINDOW_MS = 5 * 60_000;

const locOf = (v: unknown): Loc => (v === "pt-PT" ? "pt-PT" : "en");
const bodyObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const ENTITY_TYPES = new Set(["place", "cuisine", "topic", "activity", "artist", "title", "person", "goal"]);

// Same non-authoritative local-cache pattern as the Express build's
// `blockedUntil` Map: the real enforcement is the DB-backed
// countBadSignature table (shared, survives restarts), this Map just skips
// a DB round trip once an IP is already over budget within ONE isolate. A
// Worker having many isolates (each with its own empty Map on cold start)
// changes nothing about correctness, only how often the fast-path cache hits.
const blockedUntil = new Map<string, number>();
async function noteBadSignature(ip: string, now: number): Promise<boolean> {
  const until = blockedUntil.get(ip);
  if (until && until > now) return true;
  let n = 0;
  try {
    n = await countBadSignature(ip, now, BAD_WINDOW_MS);
  } catch (e) {
    logger.warn("OmniBuddy failure counter unavailable", { error: (e as Error).name });
    return false;
  }
  if (n > BAD_LIMIT) {
    if (blockedUntil.size > 10_000) blockedUntil.clear();
    blockedUntil.set(ip, now + BAD_WINDOW_MS);
    return true;
  }
  return false;
}

const clientIp = (c: import("hono").Context): string =>
  (c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown").slice(0, 64);

export const buddyRouter = new Hono<{ Bindings: WorkerBindings }>();

buddyRouter.get("/health", (c) => c.json({ ok: true, version: VERSION, contract: CONTRACT_VERSION, app: "planbuddy" }));

/**
 * Reads the raw body ONCE (needed verbatim for the HMAC check) and parses
 * it as JSON for the handler — mirrors the Express build's
 * `express.json({ verify: ... captures rawBody })` without double-reading
 * the request stream (Hono's c.req.json() would otherwise consume it again).
 */
async function readSignedBody(c: import("hono").Context): Promise<{ raw: string; json: Record<string, unknown> }> {
  const raw = await c.req.text().catch(() => "");
  let json: Record<string, unknown> = {};
  if (raw) {
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  return { raw, json };
}

declare module "hono" {
  interface ContextVariableMap {
    omniLink?: OmniLink;
    omniBody?: Record<string, unknown>;
  }
}

/**
 * Signed requests only: X-Omni-Link picks the key, X-Omni-Signature =
 * HMAC(ts + '.' + body). State-changing requests are also replay-protected
 * (claimSignature); GET /card stays idempotent — identical contract to the
 * Express build's requireSigned.
 */
async function requireSigned(c: import("hono").Context, next: import("hono").Next): Promise<Response | void> {
  const linkId = (c.req.header("X-Omni-Link") ?? "").slice(0, 128);
  const now = Date.now();
  const link = linkId ? await getLinkById(linkId) : null;
  const sig = c.req.header("X-Omni-Signature");
  const tsHeader = c.req.header("X-Omni-Timestamp");
  const { raw, json } = await readSignedBody(c);
  if (!link || !verifySignature(link.signingKey, tsHeader, sig, raw, now, SKEW_MS)) {
    const blocked = await noteBadSignature(clientIp(c), now);
    return c.json({ error: "bad signature" }, blocked ? 429 : 401);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const fresh = await claimSignature(link.linkId, String(sig).toLowerCase(), now, SKEW_MS);
    if (!fresh) {
      return c.json({ error: "request already used" }, 401);
    }
  }
  c.set("omniLink", link);
  c.set("omniBody", json);
  await next();
}

buddyRouter.get("/card", requireSigned, async (c) => {
  const link = c.get("omniLink")!;
  try {
    return c.json(await buildCard(link.userId, locOf(c.req.query("locale"))));
  } catch (e) {
    logger.warn("OmniBuddy card failed", { error: (e as Error).name });
    return c.json({
      state: "error",
      title: "PlanBuddy could not read your plan",
      body: "Something went wrong on PlanBuddy's side. Try again in a moment.",
    });
  }
});

buddyRouter.post("/act", requireSigned, async (c) => {
  const link = c.get("omniLink")!;
  const userId = link.userId;
  const raw = c.get("omniBody") ?? {};
  const cand = bodyObject(raw.candidate);
  const b = { action: str(raw.action, 24), actionId: str(raw.actionId, 48), undoToken: str(raw.undoToken, 96), locale: raw.locale };
  const loc = locOf(b.locale);

  if (b.action === "undo") {
    const u = b.undoToken ? await claimUndo(userId, b.undoToken) : null;
    if (!u) {
      return c.json(
        { ok: false, message: loc === "pt-PT" ? "Token de anulação desconhecido ou já usado." : "Unknown or already used undo token." },
        400
      );
    }
    if (u.kind === "lock") await unlockPlan(userId, String(u.payload.planId));
    if (u.kind === "wants") {
      await deleteTaste(userId, String(u.payload.tasteId));
      c.executionCtx?.waitUntil(syncToHub(userId));
    }
    return c.json({ ok: true, message: loc === "pt-PT" ? "Desfeito." : "Undone." });
  }

  if (b.action === "primary") {
    if (b.actionId === "view_plan") {
      return c.json({
        ok: true,
        message: loc === "pt-PT" ? "O plano já está fixado." : "The plan is already locked.",
        undoToken: await createUndo(userId, "noop", {}),
      });
    }
    const r = await lockCurrentPlan(userId, loc);
    if (!r.ok) return c.json({ ok: false, message: r.message });
    const undoToken = await createUndo(userId, r.noop ? "noop" : "lock", { planId: r.planId ?? null });
    return c.json({ ok: true, message: r.message, undoToken });
  }

  if (b.action === "accept") {
    const title = sanitizeHubText(cand.title, 120);
    if (!title) return c.json({ ok: false, message: "candidate.title is required" }, 400);
    const whereRaw = sanitizeHubText(cand.where, 80);
    const where = whereRaw ? ` (${whereRaw})` : "";
    const taste = await createTaste(userId, { participantId: null, text: `${WANTS_PREFIX} ${title}${where}`, polarity: "love", weight: 0.5, source: "stated" });
    const undoToken = await createUndo(userId, "wants", { tasteId: taste.id });
    c.executionCtx?.waitUntil(syncToHub(userId));
    return c.json({
      ok: true,
      message: loc === "pt-PT" ? `Guardado nas tuas ideias: ${title}.` : `Saved to your ideas: ${title}.`,
      undoToken,
    });
  }

  return c.json({ ok: false, message: "unknown action" }, 400);
});

buddyRouter.post("/suggest", requireSigned, async (c) => {
  const link = c.get("omniLink")!;
  const b = c.get("omniBody") ?? {};
  const ent = bodyObject(b.entity);
  const type = str(ent.type, 24);
  const entity = { type: ENTITY_TYPES.has(type) ? type : undefined, canonical: str(ent.canonical, 121) };
  return c.json({ candidates: await suggestFor(link.userId, entity, locOf(b.locale as unknown)) });
});

// ------------------------------------------------------------- link (signed-in user via cookie)
buddyRouter.post("/link", omniLinkRateLimiter, requireSameOrigin, attachUser, async (c) => {
  const user = c.get("user");
  if (!c.req.header("cookie") || !user) {
    return c.json({ ok: false, error: "Sign in to PlanBuddy first, then link it from OmniBuddy." }, 401);
  }
  const base = hubBase();
  if (!base) {
    return c.json({ ok: false, error: "PlanBuddy is not configured to reach the OmniBuddy hub yet." }, 400);
  }
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
    return c.json({ ok: false, error: "A valid link code is required" }, 400);
  }
  const r = await completeLink(base, code, user.id);
  if ("error" in r) return c.json({ ok: false, error: r.error }, 400);
  await saveLink({ userId: user.id, linkId: r.link_id, hubToken: r.token, signingKey: r.signing_key, hubUrl: base });
  const pushed = await syncToHub(user.id);
  return c.json({ ok: true, linked: true, pushed: pushed?.pushed ?? 0 });
});

buddyRouter.get("/link", attachUser, requireAuth, async (c) => {
  const user = c.get("user")!;
  return c.json({ linked: Boolean(await getLinkForUser(user.id)), hubConfigured: Boolean(hubBase()) });
});

buddyRouter.post("/unlink", requireSameOrigin, attachUser, requireAuth, async (c) => {
  await deleteLink(c.get("user")!.id);
  return c.json({ ok: true });
});

// ------------------------------------------------------- connect (hub -> Buddy, automatic link)
async function requireConnectSigned(c: import("hono").Context, next: import("hono").Next): Promise<Response | void> {
  const now = Date.now();
  const key = connectKey();
  if (!key) return c.json({ error: "connect not configured" }, 503);
  const sig = c.req.header("X-Omni-Signature");
  const { raw, json } = await readSignedBody(c);
  if (!verifySignature(key, c.req.header("X-Omni-Timestamp"), sig, raw, now, SKEW_MS)) {
    const blocked = await noteBadSignature(clientIp(c), now);
    return c.json({ error: "bad signature" }, blocked ? 429 : 401);
  }
  if (!(await claimSignature("connect", String(sig).toLowerCase(), now, SKEW_MS))) {
    return c.json({ error: "request already used" }, 401);
  }
  c.set("omniBody", json);
  await next();
}

buddyRouter.post("/connect", requireConnectSigned, async (c) => {
  const b = c.get("omniBody") ?? {};
  if (b.email_verified !== true) return c.json({ ok: false, reason: "not_verified" }, 409);
  const base = hubBase();
  const claimed = typeof b.hub_url === "string" ? b.hub_url.trim().replace(/\/$/, "") : "";
  if (!base || (claimed && claimed !== base)) return c.json({ ok: false, reason: "bad_hub" }, 400);
  const code = typeof b.code === "string" ? b.code.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(code) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ ok: false, reason: "bad_request" }, 400);
  }

  const loginRaw = bodyObject(b.login);
  const hasLogin = b.login !== undefined && b.login !== null;
  if (hasLogin) {
    const loginEmail = typeof loginRaw.email === "string" ? loginRaw.email.trim().toLowerCase() : "";
    const loginPassword = typeof loginRaw.password === "string" ? loginRaw.password : "";
    const LOGIN_WINDOW_MS = 15 * 60_000;
    const LOGIN_MAX_ATTEMPTS = 5;
    if (!loginEmail || loginEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail) || !loginPassword || loginPassword.length > 256) {
      return c.json({ ok: false, reason: "bad_login" }, 401);
    }
    const now = Date.now();
    const fails = await getConnectLoginFailures(loginEmail, now, LOGIN_WINDOW_MS);
    if (fails >= LOGIN_MAX_ATTEMPTS) return c.json({ ok: false, reason: "too_many_attempts" }, 429);
    const account = await getUserByEmail(loginEmail);
    const DUMMY_HASH = "$2a$12$Vet7Lv6s9LasKTZcrjHE7O2UTZWgKIUHza46PdT5xCsb9DQqsYiA.";
    const passOk = await verifyPassword(loginPassword, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !passOk) {
      await recordConnectLoginFailure(loginEmail, now, LOGIN_WINDOW_MS);
      return c.json({ ok: false, reason: "bad_login" }, 401);
    }
    await clearConnectLoginFailures(loginEmail);
    const r = await completeLink(base, code, account.id);
    if ("error" in r) return c.json({ ok: false, reason: "code_rejected" }, 400);
    await saveLink({ userId: account.id, linkId: r.link_id, hubToken: r.token, signingKey: r.signing_key, hubUrl: base });
    c.executionCtx?.waitUntil(syncToHub(account.id));
    return c.json({ ok: true });
  }

  let userId: string;
  const existing = await getUserForConnect(email);
  if (existing) {
    if (!existing.hubVerified) return c.json({ ok: false, reason: "manual_required" }, 409);
    userId = existing.id;
  } else {
    const randomPassword = crypto.randomUUID() + crypto.randomUUID();
    const created = await createHubVerifiedUser(email, await hashPassword(randomPassword));
    if (!created) return c.json({ ok: false, reason: "manual_required" }, 409);
    await seedOwnerParticipant(created);
    userId = created;
  }
  const r = await completeLink(base, code, userId);
  if ("error" in r) return c.json({ ok: false, reason: "code_rejected" }, 400);
  await saveLink({ userId, linkId: r.link_id, hubToken: r.token, signingKey: r.signing_key, hubUrl: base });
  c.executionCtx?.waitUntil(syncToHub(userId));
  return c.json({ ok: true });
});

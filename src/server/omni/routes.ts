// Buddy Contract v1 endpoints (OmniBuddy hub). Everything except /health requires the hub's HMAC signature,
// whose key is issued per link by the hub and stored in omni_links. The user is identified by the link, never by input.
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { readFileSync } from "node:fs";
import { asyncHandler } from "../http.js";
import { logger } from "../logger.js";
import { attachUser, requireAuth, requireSameOrigin } from "../auth/middleware.js";
import { createTaste, deleteTaste } from "../memory/tastes.repo.js";
import { buildCard, lockCurrentPlan, unlockPlan, type Loc } from "./card.js";
import crypto from "node:crypto";
import { CONTRACT_VERSION, WANTS_PREFIX, completeLink, connectKey, hubBase, sanitizeHubText, scheduleSync, syncToHub, verifySignature } from "./hub.js";
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
} from "./repo.js";
import { createHubVerifiedUser, getUserByEmail, getUserForConnect } from "../users/repo.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { seedOwnerParticipant } from "../participants/repo.js";
import { suggestFor } from "./suggest.js";

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    return String((JSON.parse(raw) as { version?: string }).version ?? "unknown");
  } catch {
    return "unknown";
  }
}
const VERSION = readVersion();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
      omniLink?: OmniLink;
    }
  }
}

export const buddyRouter = Router();

const locOf = (v: unknown): Loc => (v === "pt-PT" ? "pt-PT" : "en");

buddyRouter.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION, contract: CONTRACT_VERSION, app: "planbuddy" });
});

const SKEW_MS = 5 * 60_000;

// Brute-force damper. It runs ONLY after a signature has failed verification, counts per source IP (never per
// link id), and is never consulted for a valid signature: an attacker can neither burn the real hub's budget nor
// lock it out. At most the attacker's own IP gets 429 instead of 401.
const BAD_LIMIT = 60;
const BAD_WINDOW_MS = 5 * 60_000;
// Source IP: req.ip with `trust proxy` = 1 is the address the platform's proxy appended to X-Forwarded-For, i.e. the
// right-most trusted hop. Entries an attacker puts at the front of X-Forwarded-For are ignored, so the key cannot be
// spoofed or rotated by header, and it is never the raw socket (proxy) address.
const clientIp = (req: Request): string => (req.ip || req.socket.remoteAddress || "unknown").slice(0, 64);

// Once an IP is over the limit it is remembered in memory for the rest of the window, so a flood is answered 429
// with no further database write; the authoritative counter is the shared table (survives restarts, atomic).
const blockedUntil = new Map<string, number>();
async function noteBadSignature(ip: string, now: number): Promise<boolean> {
  const until = blockedUntil.get(ip);
  if (until && until > now) return true;
  let n = 0;
  try {
    n = await countBadSignature(ip, now, BAD_WINDOW_MS);
  } catch (e) {
    // the damper is best-effort: a database problem must never turn a rejected request into a 500
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

/**
 * Signed requests only: header X-Omni-Link picks the key, X-Omni-Signature = HMAC(ts + '.' + body).
 * State-changing requests (anything but GET) are also replay-protected: an accepted signature is remembered for
 * the whole skew window (both directions) and a second use of it is refused. GET /card stays idempotent.
 */
async function requireSigned(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const linkId = (req.get("X-Omni-Link") ?? "").slice(0, 128);
    const now = Date.now(); // the single clock for this request: timestamp validation and replay expiry
    const link = linkId ? await getLinkById(linkId) : null;
    const sig = req.get("X-Omni-Signature");
    const tsHeader = req.get("X-Omni-Timestamp");
    if (!link || !verifySignature(link.signingKey, tsHeader, sig, req.rawBody ?? "", now, SKEW_MS)) {
      res.status((await noteBadSignature(clientIp(req), now)) ? 429 : 401).json({ error: "bad signature" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      // remembered past the last moment this timestamp could still pass the skew check, on the same clock
      const fresh = await claimSignature(link.linkId, String(sig).toLowerCase(), now, SKEW_MS);
      if (!fresh) {
        res.status(401).json({ error: "request already used" });
        return;
      }
    }
    req.omniLink = link;
    next();
  } catch (e) {
    next(e);
  }
}

const signedGuards = [requireSigned];

const bodyObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const ENTITY_TYPES = new Set(["place", "cuisine", "topic", "activity", "artist", "title", "person", "goal"]);

// ---------------------------------------------------------------------------- link (signed-in user)
// A request with no cookie at all has no session, so say so in the contract's {ok:false} shape; anything that
// does carry a cookie still goes through the unchanged same-origin guard.
const answerAnonymous = (req: Request, res: Response, next: NextFunction) => {
  if (!req.headers.cookie) {
    res.status(401).json({ ok: false, error: "Sign in to PlanBuddy first, then link it from OmniBuddy." });
    return;
  }
  next();
};
const sessionOnly = [requireSameOrigin, asyncHandler(async (req, res, next) => attachUser(req, res, next))];
const linkLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: "Too many attempts. Wait a few minutes and try again." } });
const linkGuards = [linkLimiter, answerAnonymous, ...sessionOnly];

buddyRouter.post(
  "/link",
  ...linkGuards,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: "Sign in to PlanBuddy first, then link it from OmniBuddy." });
      return;
    }
    const base = hubBase();
    if (!base) {
      res.status(400).json({ ok: false, error: "PlanBuddy is not configured to reach the OmniBuddy hub yet." });
      return;
    }
    // link codes are short, single-use and issued by the hub; anything else is refused before it leaves this server
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
      res.status(400).json({ ok: false, error: "A valid link code is required" });
      return;
    }
    // the hub URL comes from server configuration only; a hubUrl in the body is ignored (SSRF defence)
    const r = await completeLink(base, code, req.user.id);
    if ("error" in r) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    await saveLink({ userId: req.user.id, linkId: r.link_id, hubToken: r.token, signingKey: r.signing_key, hubUrl: base });
    const pushed = await syncToHub(req.user.id);
    res.json({ ok: true, linked: true, pushed: pushed?.pushed ?? 0 });
  })
);

buddyRouter.get(
  "/link",
  asyncHandler(async (req, res, next) => attachUser(req, res, next)),
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ linked: Boolean(await getLinkForUser(req.user!.id)), hubConfigured: Boolean(hubBase()) });
  })
);

buddyRouter.post(
  "/unlink",
  ...sessionOnly,
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteLink(req.user!.id);
    res.json({ ok: true });
  })
);

// -------------------------------------------------------------------------------------- signed API
buddyRouter.get(
  "/card",
  ...signedGuards,
  asyncHandler(async (req, res) => {
    try {
      res.json(await buildCard(req.omniLink!.userId, locOf(req.query.locale)));
    } catch (e) {
      logger.warn("OmniBuddy card failed", { error: (e as Error).name });
      res.json({ state: "error", title: "PlanBuddy could not read your plan", body: "Something went wrong on PlanBuddy's side. Try again in a moment." });
    }
  })
);

buddyRouter.post(
  "/act",
  ...signedGuards,
  asyncHandler(async (req, res) => {
    const userId = req.omniLink!.userId;
    const raw = bodyObject(req.body);
    const cand = bodyObject(raw.candidate);
    const b = { action: str(raw.action, 24), actionId: str(raw.actionId, 48), undoToken: str(raw.undoToken, 96), locale: raw.locale };
    const loc = locOf(b.locale);

    if (b.action === "undo") {
      const u = b.undoToken ? await claimUndo(userId, b.undoToken) : null;
      if (!u) {
        res.status(400).json({ ok: false, message: loc === "pt-PT" ? "Token de anulação desconhecido ou já usado." : "Unknown or already used undo token." });
        return;
      }
      if (u.kind === "lock") await unlockPlan(userId, String(u.payload.planId));
      if (u.kind === "wants") {
        await deleteTaste(userId, String(u.payload.tasteId));
        scheduleSync(userId);
      }
      res.json({ ok: true, message: loc === "pt-PT" ? "Desfeito." : "Undone." });
      return;
    }

    if (b.action === "primary") {
      if (b.actionId === "view_plan") {
        res.json({ ok: true, message: loc === "pt-PT" ? "O plano já está fixado." : "The plan is already locked.", undoToken: await createUndo(userId, "noop", {}) });
        return;
      }
      const r = await lockCurrentPlan(userId, loc);
      if (!r.ok) {
        res.json({ ok: false, message: r.message });
        return;
      }
      const undoToken = await createUndo(userId, r.noop ? "noop" : "lock", { planId: r.planId ?? null });
      res.json({ ok: true, message: r.message, undoToken });
      return;
    }

    if (b.action === "accept") {
      // the candidate comes from the hub and is stored as a taste that later reaches LLM prompts: sanitise it first
      const title = sanitizeHubText(cand.title, 120);
      if (!title) {
        res.status(400).json({ ok: false, message: "candidate.title is required" });
        return;
      }
      const whereRaw = sanitizeHubText(cand.where, 80);
      const where = whereRaw ? ` (${whereRaw})` : "";
      const taste = await createTaste(userId, { participantId: null, text: `${WANTS_PREFIX} ${title}${where}`, polarity: "love", weight: 0.5, source: "stated" });
      const undoToken = await createUndo(userId, "wants", { tasteId: taste.id });
      res.json({ ok: true, message: loc === "pt-PT" ? `Guardado nas tuas ideias: ${title}.` : `Saved to your ideas: ${title}.`, undoToken });
      return;
    }

    res.status(400).json({ ok: false, message: "unknown action" });
  })
);

buddyRouter.post(
  "/suggest",
  ...signedGuards,
  asyncHandler(async (req, res) => {
    const b = bodyObject(req.body);
    const ent = bodyObject(b.entity);
    const type = str(ent.type, 24);
    const entity = { type: ENTITY_TYPES.has(type) ? type : undefined, canonical: str(ent.canonical, 121) };
    res.json({ candidates: await suggestFor(req.omniLink!.userId, entity, locOf(b.locale)) });
  })
);

// ------------------------------------------------------------------- connect (hub -> Buddy, automatic link)
// Contract v1 addendum. Authenticated only by the hub's HMAC (key = OMNI_CONNECT_SECRET); same
// skew, constant-time compare, replay claim and bad-signature damper as every other signed endpoint.
async function requireConnectSigned(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const now = Date.now();
    const key = connectKey();
    if (!key) {
      res.status(503).json({ error: "connect not configured" });
      return;
    }
    const sig = req.get("X-Omni-Signature");
    if (!verifySignature(key, req.get("X-Omni-Timestamp"), sig, req.rawBody ?? "", now, SKEW_MS)) {
      res.status((await noteBadSignature(clientIp(req), now)) ? 429 : 401).json({ error: "bad signature" });
      return;
    }
    if (!(await claimSignature("connect", String(sig).toLowerCase(), now, SKEW_MS))) {
      res.status(401).json({ error: "request already used" });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
}

buddyRouter.post(
  "/connect",
  requireConnectSigned,
  asyncHandler(async (req, res) => {
    const b = bodyObject(req.body);
    if (b.email_verified !== true) {
      res.status(409).json({ ok: false, reason: "not_verified" });
      return;
    }
    const base = hubBase();
    // the hub URL must be the registry one; the body value is only checked against it, never used
    const claimed = typeof b.hub_url === "string" ? b.hub_url.trim().replace(/\/$/, "") : "";
    if (!base || (claimed && claimed !== base)) {
      res.status(400).json({ ok: false, reason: "bad_hub" });
      return;
    }
    const code = typeof b.code === "string" ? b.code.trim() : "";
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(code) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ ok: false, reason: "bad_request" });
      return;
    }
    // v1.1 addendum: the hub asked the user for that Buddy's own email+password and forwards them, so an existing
    // non-hub account can still be linked. Checked with PlanBuddy's OWN normal /login password function; never
    // creates an account; same 401 reason for "no such account", "wrong password" and "no password" (no enumeration).
    const loginRaw = bodyObject(b.login);
    const hasLogin = b.login !== undefined && b.login !== null;
    if (hasLogin) {
      const loginEmail = typeof loginRaw.email === "string" ? loginRaw.email.trim().toLowerCase() : "";
      const loginPassword = typeof loginRaw.password === "string" ? loginRaw.password : "";
      const LOGIN_WINDOW_MS = 15 * 60_000;
      const LOGIN_MAX_ATTEMPTS = 5;
      if (!loginEmail || loginEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail) || !loginPassword || loginPassword.length > 256) {
        res.status(401).json({ ok: false, reason: "bad_login" });
        return;
      }
      const now = Date.now();
      const fails = await getConnectLoginFailures(loginEmail, now, LOGIN_WINDOW_MS);
      if (fails >= LOGIN_MAX_ATTEMPTS) {
        res.status(429).json({ ok: false, reason: "too_many_attempts" });
        return;
      }
      const account = await getUserByEmail(loginEmail);
      // a dummy hash is verified even when the account does not exist, so a missing account and a wrong
      // password take the same amount of time and never let a caller tell them apart
      const DUMMY_HASH = "$2a$12$Vet7Lv6s9LasKTZcrjHE7O2UTZWgKIUHza46PdT5xCsb9DQqsYiA.";
      const passOk = await verifyPassword(loginPassword, account?.passwordHash ?? DUMMY_HASH);
      if (!account || !passOk) {
        await recordConnectLoginFailure(loginEmail, now, LOGIN_WINDOW_MS);
        res.status(401).json({ ok: false, reason: "bad_login" });
        return;
      }
      await clearConnectLoginFailures(loginEmail);
      const r = await completeLink(base, code, account.id);
      if ("error" in r) {
        res.status(400).json({ ok: false, reason: "code_rejected" });
        return;
      }
      await saveLink({ userId: account.id, linkId: r.link_id, hubToken: r.token, signingKey: r.signing_key, hubUrl: base });
      void syncToHub(account.id);
      res.json({ ok: true });
      return;
    }

    let userId: string;
    const existing = await getUserForConnect(email);
    if (existing) {
      // account-takeover guard: PlanBuddy never verified self-registered emails, so only hub-vouched accounts qualify
      if (!existing.hubVerified) {
        res.status(409).json({ ok: false, reason: "manual_required" });
        return;
      }
      userId = existing.id;
    } else {
      // no usable password: a random unguessable value nobody holds
      const created = await createHubVerifiedUser(email, await hashPassword(crypto.randomBytes(32).toString("hex")));
      if (!created) {
        // lost a race with a self-signup of the same email: treat as unverified
        res.status(409).json({ ok: false, reason: "manual_required" });
        return;
      }
      await seedOwnerParticipant(created);
      userId = created;
    }
    const r = await completeLink(base, code, userId);
    if ("error" in r) {
      res.status(400).json({ ok: false, reason: "code_rejected" });
      return;
    }
    await saveLink({ userId, linkId: r.link_id, hubToken: r.token, signingKey: r.signing_key, hubUrl: base });
    void syncToHub(userId);
    res.json({ ok: true });
  })
);

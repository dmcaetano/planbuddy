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
import { CONTRACT_VERSION, WANTS_PREFIX, completeLink, hubBase, sanitizeHubText, scheduleSync, syncToHub, verifySignature } from "./hub.js";
import { claimSignature, claimUndo, createUndo, deleteLink, getLinkById, getLinkForUser, saveLink, type OmniLink } from "./repo.js";
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
const badByIp = new Map<string, { n: number; resetAt: number }>();
function noteBadSignature(ip: string, now = Date.now()): boolean {
  if (badByIp.size > 10_000) badByIp.clear();
  const e = badByIp.get(ip);
  if (!e || e.resetAt < now) {
    badByIp.set(ip, { n: 1, resetAt: now + BAD_WINDOW_MS });
    return false;
  }
  e.n++;
  return e.n > BAD_LIMIT;
}

/**
 * Signed requests only: header X-Omni-Link picks the key, X-Omni-Signature = HMAC(ts + '.' + body).
 * State-changing requests (anything but GET) are also replay-protected: an accepted signature is remembered for
 * the whole skew window (both directions) and a second use of it is refused. GET /card stays idempotent.
 */
async function requireSigned(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const linkId = (req.get("X-Omni-Link") ?? "").slice(0, 128);
    const link = linkId ? await getLinkById(linkId) : null;
    const sig = req.get("X-Omni-Signature");
    const tsHeader = req.get("X-Omni-Timestamp");
    if (!link || !verifySignature(link.signingKey, tsHeader, sig, req.rawBody ?? "")) {
      res.status(noteBadSignature(req.ip ?? "?") ? 429 : 401).json({ error: "bad signature" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      // remembered until the signature's own timestamp can no longer pass the skew check (never shorter)
      const expiresAt = Math.max(Number(tsHeader) + SKEW_MS + 60_000, Date.now() + SKEW_MS + 60_000);
      const fresh = await claimSignature(link.linkId, String(sig).toLowerCase(), expiresAt);
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

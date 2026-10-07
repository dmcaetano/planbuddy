// Buddy Contract v1 endpoints (OmniBuddy hub). Everything except /health requires the hub's HMAC signature,
// whose key is issued per link by the hub and stored in omni_links. The user is identified by the link, never by input.
import { Router, type NextFunction, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { asyncHandler } from "../http.js";
import { attachUser, requireAuth, requireSameOrigin } from "../auth/middleware.js";
import { createTaste, deleteTaste } from "../memory/tastes.repo.js";
import { buildCard, lockCurrentPlan, unlockPlan, type Loc } from "./card.js";
import { CONTRACT_VERSION, WANTS_PREFIX, completeLink, hubBase, scheduleSync, syncToHub, verifySignature } from "./hub.js";
import { claimUndo, createUndo, deleteLink, getLinkById, getLinkForUser, saveLink, type OmniLink } from "./repo.js";
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

/** Signed requests only: header X-Omni-Link picks the key, X-Omni-Signature = HMAC(ts + '.' + body). */
async function requireSigned(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const linkId = req.get("X-Omni-Link") ?? "";
    const link = linkId ? await getLinkById(linkId) : null;
    if (!link || !verifySignature(link.signingKey, req.get("X-Omni-Timestamp"), req.get("X-Omni-Signature"), req.rawBody ?? "")) {
      res.status(401).json({ error: "bad signature" });
      return;
    }
    req.omniLink = link;
    next();
  } catch (e) {
    next(e);
  }
}

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
const linkGuards = [answerAnonymous, ...sessionOnly];

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
    const code = typeof req.body?.code === "string" ? req.body.code.trim().slice(0, 64) : "";
    if (!code) {
      res.status(400).json({ ok: false, error: "code is required" });
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
  requireSigned,
  asyncHandler(async (req, res) => {
    try {
      res.json(await buildCard(req.omniLink!.userId, locOf(req.query.locale)));
    } catch (e) {
      res.json({ state: "error", title: "PlanBuddy could not read your plan", body: String((e as Error).message).slice(0, 200) });
    }
  })
);

buddyRouter.post(
  "/act",
  requireSigned,
  asyncHandler(async (req, res) => {
    const userId = req.omniLink!.userId;
    const b = (req.body ?? {}) as { action?: string; actionId?: string; undoToken?: string; candidate?: { title?: string; where?: string }; locale?: string };
    const loc = locOf(b.locale);

    if (b.action === "undo") {
      const u = typeof b.undoToken === "string" ? await claimUndo(userId, b.undoToken) : null;
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
      const title = typeof b.candidate?.title === "string" ? b.candidate.title.trim().slice(0, 120) : "";
      if (!title) {
        res.status(400).json({ ok: false, message: "candidate.title is required" });
        return;
      }
      const where = typeof b.candidate?.where === "string" && b.candidate.where.trim() ? ` (${b.candidate.where.trim().slice(0, 80)})` : "";
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
  requireSigned,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as { entity?: { type?: string; canonical?: string }; locale?: string };
    res.json({ candidates: await suggestFor(req.omniLink!.userId, b.entity ?? {}, locOf(b.locale)) });
  })
);

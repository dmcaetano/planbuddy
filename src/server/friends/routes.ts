import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { publicTokenRateLimiter } from "../rateLimit.js";
import { friendTokenSchema } from "../../shared/schemas.js";
import {
  acceptFriendInvite,
  blockUser,
  createFriendInvite,
  displayName,
  getFriendInvite,
  listBlocked,
  listFriendLabelSummaries,
  listFriends,
  removeFriend,
  replaceFriendLabels,
  unblockUser,
} from "./repo.js";
import { friendLabelsReplaceSchema } from "./schemas.js";

export const friendsRouter = Router();

friendsRouter.get(
  "/invites/:token",
  publicTokenRateLimiter,
  asyncHandler(async (req, res) => {
    const token = friendTokenSchema.safeParse(req.params.token);
    if (!token.success) throw notFound();
    const invite = await getFriendInvite(token.data);
    if (!invite || (invite.accepted_by_user_id && !req.user)) throw notFound();
    res.json({
      invite: {
        inviterDisplayName: displayName(invite.inviter_email),
        expiresAt: invite.expires_at,
        accepted: Boolean(invite.accepted_at),
      },
    });
  })
);

friendsRouter.post(
  "/invites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const invite = await createFriendInvite(req.user!.id);
    res.status(201).json({ invite });
  })
);

friendsRouter.post(
  "/invites/:token/accept",
  requireAuth,
  publicTokenRateLimiter,
  asyncHandler(async (req, res) => {
    const token = friendTokenSchema.safeParse(req.params.token);
    if (!token.success) throw notFound();
    const result = await acceptFriendInvite(token.data, req.user!.id);
    if (!result) throw notFound();
    res.json({ friendship: { status: "connected", ...result } });
  })
);

friendsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ friends: await listFriends(req.user!.id) });
  })
);

friendsRouter.delete(
  "/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await removeFriend(req.user!.id, req.params.userId))) throw notFound();
    res.status(204).end();
  })
);

friendsRouter.get(
  "/labels",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ labels: await listFriendLabelSummaries(req.user!.id) });
  })
);

friendsRouter.put(
  "/:userId/labels",
  requireAuth,
  validateBody(friendLabelsReplaceSchema),
  asyncHandler(async (req, res) => {
    const labels = await replaceFriendLabels(req.user!.id, req.params.userId, req.body.labels);
    if (labels === null) throw notFound();
    res.json({ labels });
  })
);

friendsRouter.get(
  "/blocked",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ blocked: await listBlocked(req.user!.id) });
  })
);

friendsRouter.post(
  "/:userId/block",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await blockUser(req.user!.id, req.params.userId))) throw notFound();
    res.status(204).end();
  })
);

friendsRouter.delete(
  "/:userId/block",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await unblockUser(req.user!.id, req.params.userId))) throw notFound();
    res.status(204).end();
  })
);

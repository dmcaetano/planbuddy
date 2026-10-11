import { Hono } from "hono";
import { friendTokenSchema } from "../shared/schemas.js";
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
} from "../server/friends/repo.js";
import { friendLabelsReplaceSchema } from "../server/friends/schemas.js";
import { requireAuth } from "./middleware.js";
import { parseBody, notFoundResponse } from "./http.js";
import { publicTokenRateLimiter } from "./rateLimit.js";

export const friendsRouter = new Hono();

friendsRouter.get("/invites/:token", publicTokenRateLimiter, async (c) => {
  const token = friendTokenSchema.safeParse(c.req.param("token"));
  if (!token.success) return notFoundResponse(c);
  const invite = await getFriendInvite(token.data);
  if (!invite || (invite.accepted_by_user_id && !c.get("user"))) return notFoundResponse(c);
  return c.json({
    invite: {
      inviterDisplayName: displayName(invite.inviter_email),
      expiresAt: invite.expires_at,
      accepted: Boolean(invite.accepted_at),
    },
  });
});

friendsRouter.post("/invites", requireAuth, async (c) => {
  const invite = await createFriendInvite(c.get("user")!.id);
  return c.json({ invite }, 201);
});

friendsRouter.post("/invites/:token/accept", requireAuth, publicTokenRateLimiter, async (c) => {
  const token = friendTokenSchema.safeParse(c.req.param("token"));
  if (!token.success) return notFoundResponse(c);
  const result = await acceptFriendInvite(token.data, c.get("user")!.id);
  if (!result) return notFoundResponse(c);
  return c.json({ friendship: { status: "connected", ...result } });
});

friendsRouter.get("/", requireAuth, async (c) => {
  return c.json({ friends: await listFriends(c.get("user")!.id) });
});

friendsRouter.delete("/:userId", requireAuth, async (c) => {
  if (!(await removeFriend(c.get("user")!.id, c.req.param("userId")))) return notFoundResponse(c);
  return c.body(null, 204);
});

friendsRouter.get("/labels", requireAuth, async (c) => {
  return c.json({ labels: await listFriendLabelSummaries(c.get("user")!.id) });
});

friendsRouter.put("/:userId/labels", requireAuth, async (c) => {
  const body = await parseBody(c, friendLabelsReplaceSchema);
  if (body instanceof Response) return body;
  const labels = await replaceFriendLabels(c.get("user")!.id, c.req.param("userId"), body.labels);
  if (labels === null) return notFoundResponse(c);
  return c.json({ labels });
});

friendsRouter.get("/blocked", requireAuth, async (c) => {
  return c.json({ blocked: await listBlocked(c.get("user")!.id) });
});

friendsRouter.post("/:userId/block", requireAuth, async (c) => {
  if (!(await blockUser(c.get("user")!.id, c.req.param("userId")))) return notFoundResponse(c);
  return c.body(null, 204);
});

friendsRouter.delete("/:userId/block", requireAuth, async (c) => {
  if (!(await unblockUser(c.get("user")!.id, c.req.param("userId")))) return notFoundResponse(c);
  return c.body(null, 204);
});

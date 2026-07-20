import crypto from "node:crypto";
import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Friend, Participant } from "../../shared/types.js";

const INVITE_TTL_DAYS = 14;

interface PlanningParticipantRow {
  id: string;
  user_id: string;
  name: string;
  kind: "person" | "pet";
  relationship: string | null;
  is_owner: boolean;
  created_at: string;
  account_email: string | null;
  is_friend_account: boolean;
}

interface FriendRow extends PlanningParticipantRow {
  connected_at: string;
}

export interface FriendLabel {
  id: string;
  name: string;
}

export interface FriendWithLabels extends Friend {
  labels: FriendLabel[];
}

export interface FriendLabelSummary {
  id: string;
  name: string;
  memberCount: number;
  friendUserIds: string[];
}

export interface BlockedFriend {
  userId: string;
  email: string;
  displayName: string;
  blockedAt: string;
}

interface InviteRow {
  id: string;
  inviter_user_id: string;
  inviter_email: string;
  expires_at: string;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function displayName(email: string): string {
  const local = email.split("@")[0] ?? "Friend";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || "Friend";
}

function toParticipant(row: PlanningParticipantRow): Participant {
  const email = row.account_email ?? "";
  return {
    id: row.id,
    userId: row.user_id,
    name: row.is_friend_account ? displayName(email) : row.name,
    kind: row.kind,
    relationship: row.is_friend_account ? "PlanBuddy friend" : row.relationship,
    isOwner: row.is_owner,
    isFriendAccount: row.is_friend_account,
    accountEmail: row.is_friend_account ? email : null,
    createdAt: row.created_at,
  };
}

function canonicalPair(userId: string, friendUserId: string): [string, string] {
  return userId < friendUserId ? [userId, friendUserId] : [friendUserId, userId];
}

export async function createFriendInvite(userId: string): Promise<{ token: string; expiresAt: string }> {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO friend_invites (id, inviter_user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [newId(), userId, tokenHash(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function getFriendInvite(token: string): Promise<InviteRow | null> {
  const db = await getDb();
  const { rows } = await db.query<InviteRow>(
    `SELECT fi.*, u.email AS inviter_email
     FROM friend_invites fi
     JOIN users u ON u.id = fi.inviter_user_id
     WHERE fi.token_hash = $1 AND fi.revoked_at IS NULL AND fi.expires_at > now()`,
    [tokenHash(token)]
  );
  return rows[0] ?? null;
}

export async function acceptFriendInvite(
  token: string,
  acceptingUserId: string
): Promise<{ inviterUserId: string; inviterDisplayName: string } | null> {
  const db = await getDb();
  const invite = await getFriendInvite(token);
  if (!invite || invite.inviter_user_id === acceptingUserId) return null;
  if (invite.accepted_by_user_id && invite.accepted_by_user_id !== acceptingUserId) return null;
  // A block on either side of the pair silently kills the redemption -- this
  // reuses the same "invalid invite" 404 the caller already returns for
  // expired/guessed tokens, so a blocked user never learns they were blocked.
  if (await isBlockedPair(invite.inviter_user_id, acceptingUserId)) return null;

  const { rows } = await db.query<InviteRow>(
    `UPDATE friend_invites
     SET accepted_by_user_id = COALESCE(accepted_by_user_id, $2),
         accepted_at = COALESCE(accepted_at, now())
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()
       AND (accepted_by_user_id IS NULL OR accepted_by_user_id = $2)
     RETURNING *`,
    [tokenHash(token), acceptingUserId]
  );
  if (!rows[0]) return null;

  const [userA, userB] = canonicalPair(invite.inviter_user_id, acceptingUserId);
  await db.query(
    `INSERT INTO friendships (user_a_id, user_b_id, status, ended_at)
     VALUES ($1, $2, 'active', NULL)
     ON CONFLICT (user_a_id, user_b_id)
     DO UPDATE SET status = 'active', ended_at = NULL`,
    [userA, userB]
  );
  return { inviterUserId: invite.inviter_user_id, inviterDisplayName: displayName(invite.inviter_email) };
}

export async function listFriends(userId: string): Promise<FriendWithLabels[]> {
  const db = await getDb();
  const { rows } = await db.query<FriendRow>(
    `SELECT p.*, u.email AS account_email, true AS is_friend_account, f.created_at AS connected_at
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
     JOIN participants p ON p.user_id = u.id AND p.is_owner = true
     WHERE f.status = 'active' AND (f.user_a_id = $1 OR f.user_b_id = $1)
     ORDER BY u.email`,
    [userId]
  );
  return Promise.all(
    rows.map(async (row) => ({
      userId: row.user_id,
      email: row.account_email ?? "",
      displayName: displayName(row.account_email ?? ""),
      participant: toParticipant(row),
      connectedAt: row.connected_at,
      labels: await getFriendLabels(userId, row.user_id),
    }))
  );
}

export async function listAuthorizedPlanningParticipants(userId: string): Promise<Participant[]> {
  const db = await getDb();
  const { rows } = await db.query<PlanningParticipantRow>(
    `SELECT p.*, NULL::text AS account_email, false AS is_friend_account
     FROM participants p
     WHERE p.user_id = $1
     UNION ALL
     SELECT p.*, u.email AS account_email, true AS is_friend_account
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
     JOIN participants p ON p.user_id = u.id AND p.is_owner = true
     WHERE f.status = 'active' AND (f.user_a_id = $1 OR f.user_b_id = $1)
     ORDER BY is_owner DESC, created_at ASC`,
    [userId]
  );
  return rows.map(toParticipant);
}

export async function planningParticipantIdsAreAuthorized(userId: string, participantIds: string[]): Promise<boolean> {
  const requested = new Set(participantIds);
  if (requested.size !== participantIds.length) return false;
  const allowed = new Set((await listAuthorizedPlanningParticipants(userId)).map((participant) => participant.id));
  return participantIds.every((id) => allowed.has(id));
}

export async function removeFriend(userId: string, friendUserId: string): Promise<boolean> {
  if (userId === friendUserId) return false;
  const db = await getDb();
  const [userA, userB] = canonicalPair(userId, friendUserId);
  const { rows } = await db.query<{ user_a_id: string }>(
    `UPDATE friendships SET status = 'removed', ended_at = now()
     WHERE user_a_id = $1 AND user_b_id = $2 AND status = 'active'
     RETURNING user_a_id`,
    [userA, userB]
  );
  return rows.length > 0;
}

async function activeFriendshipExists(userId: string, friendUserId: string): Promise<boolean> {
  const db = await getDb();
  const [userA, userB] = canonicalPair(userId, friendUserId);
  const { rows } = await db.query(
    `SELECT 1 FROM friendships WHERE user_a_id = $1 AND user_b_id = $2 AND status = 'active'`,
    [userA, userB]
  );
  return rows.length > 0;
}

/* ---------------------------------------------------------------------- */
/* Blocking                                                                 */
/* ---------------------------------------------------------------------- */

export async function isBlockedPair(userId: string, otherUserId: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT 1 FROM friend_blocks
     WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
        OR (blocker_user_id = $2 AND blocked_user_id = $1)`,
    [userId, otherUserId]
  );
  return rows.length > 0;
}

export async function blockUser(userId: string, targetUserId: string): Promise<boolean> {
  if (userId === targetUserId) return false;
  const db = await getDb();
  const target = await db.query(`SELECT 1 FROM users WHERE id = $1`, [targetUserId]);
  if (!target.rows[0]) return false;

  await db.query(
    `INSERT INTO friend_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)
     ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
    [userId, targetUserId]
  );

  // Ends any active friendship, like remove -- block is a superset of remove.
  const [userA, userB] = canonicalPair(userId, targetUserId);
  await db.query(
    `UPDATE friendships SET status = 'removed', ended_at = now()
     WHERE user_a_id = $1 AND user_b_id = $2 AND status = 'active'`,
    [userA, userB]
  );
  return true;
}

export async function unblockUser(userId: string, targetUserId: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query(
    `DELETE FROM friend_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2 RETURNING blocker_user_id`,
    [userId, targetUserId]
  );
  return rows.length > 0;
}

export async function listBlocked(userId: string): Promise<BlockedFriend[]> {
  const db = await getDb();
  const { rows } = await db.query<{ user_id: string; email: string; blocked_at: string }>(
    `SELECT u.id AS user_id, u.email, fb.created_at AS blocked_at
     FROM friend_blocks fb
     JOIN users u ON u.id = fb.blocked_user_id
     WHERE fb.blocker_user_id = $1
     ORDER BY fb.created_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: displayName(row.email),
    blockedAt: row.blocked_at,
  }));
}

/* ---------------------------------------------------------------------- */
/* Circle labels                                                            */
/* ---------------------------------------------------------------------- */

export async function getFriendLabels(ownerId: string, friendUserId: string): Promise<FriendLabel[]> {
  const db = await getDb();
  const { rows } = await db.query<FriendLabel>(
    `SELECT l.id, l.name
     FROM friend_label_assignments a
     JOIN friend_labels l ON l.id = a.label_id
     WHERE a.owner_user_id = $1 AND a.friend_user_id = $2
     ORDER BY l.name`,
    [ownerId, friendUserId]
  );
  return rows;
}

/**
 * Replaces the full label set for one friend. Returns null when the target
 * isn't an active friend of ownerId (the route treats that as 404, matching
 * the tenant-isolation posture of every other friends endpoint).
 */
export async function replaceFriendLabels(
  ownerId: string,
  friendUserId: string,
  rawNames: string[]
): Promise<FriendLabel[] | null> {
  if (ownerId === friendUserId) return null;
  if (!(await activeFriendshipExists(ownerId, friendUserId))) return null;

  const db = await getDb();
  const names = Array.from(new Set(rawNames.map((name) => name.trim()).filter(Boolean)));

  const labelIds: string[] = [];
  for (const name of names) {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM friend_labels WHERE owner_user_id = $1 AND name = $2`,
      [ownerId, name]
    );
    if (existing.rows[0]) {
      labelIds.push(existing.rows[0].id);
    } else {
      const id = newId();
      await db.query(`INSERT INTO friend_labels (id, owner_user_id, name) VALUES ($1, $2, $3)`, [id, ownerId, name]);
      labelIds.push(id);
    }
  }

  await db.query(`DELETE FROM friend_label_assignments WHERE owner_user_id = $1 AND friend_user_id = $2`, [
    ownerId,
    friendUserId,
  ]);
  for (const labelId of labelIds) {
    await db.query(
      `INSERT INTO friend_label_assignments (label_id, owner_user_id, friend_user_id) VALUES ($1, $2, $3)`,
      [labelId, ownerId, friendUserId]
    );
  }

  return getFriendLabels(ownerId, friendUserId);
}

/** Distinct labels for a user with member counts, shaped for a future one-tap group picker in plan creation. */
export async function listFriendLabelSummaries(ownerId: string): Promise<FriendLabelSummary[]> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string; name: string; friend_user_id: string }>(
    `SELECT l.id, l.name, a.friend_user_id
     FROM friend_labels l
     JOIN friend_label_assignments a ON a.label_id = l.id
     WHERE l.owner_user_id = $1
     ORDER BY l.name, a.friend_user_id`,
    [ownerId]
  );
  const byId = new Map<string, FriendLabelSummary>();
  for (const row of rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      entry = { id: row.id, name: row.name, memberCount: 0, friendUserIds: [] };
      byId.set(row.id, entry);
    }
    entry.friendUserIds.push(row.friend_user_id);
    entry.memberCount += 1;
  }
  return Array.from(byId.values());
}

export { displayName };

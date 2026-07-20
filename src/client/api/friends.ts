import { api } from "./client";
import type { BlockedFriend, FriendLabel, FriendLabelSummary, FriendWithLabels } from "./types";

/** GET /friends, now with each friend's circle labels. */
export function listFriendsWithLabels() {
  return api.get<{ friends: FriendWithLabels[] }>("/friends");
}

/**
 * GET /friends/labels — the caller's distinct circle labels with member
 * counts and member userIds, shaped for a future one-tap group picker in
 * plan creation (see PlanBuddy PlanPage integration notes).
 */
export function listFriendLabels() {
  return api.get<{ labels: FriendLabelSummary[] }>("/friends/labels");
}

/** PUT /friends/:userId/labels — replaces the full label set for one friend. */
export function replaceFriendLabels(userId: string, labels: string[]) {
  return api.put<{ labels: FriendLabel[] }>(`/friends/${userId}/labels`, { labels });
}

/** GET /friends/blocked — users the caller has blocked. */
export function listBlockedFriends() {
  return api.get<{ blocked: BlockedFriend[] }>("/friends/blocked");
}

/** POST /friends/:userId/block — ends any active friendship and prevents future reconnection. */
export function blockFriend(userId: string) {
  return api.post<void>(`/friends/${userId}/block`);
}

/** DELETE /friends/:userId/block — allows future connection again; restores nothing. */
export function unblockFriend(userId: string) {
  return api.delete<void>(`/friends/${userId}/block`);
}

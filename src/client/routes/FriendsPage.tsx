import { useEffect, useState } from "react";
import { Check, Copy, Share2, UserPlus } from "lucide-react";
import type { BlockedFriend, FriendLabel, FriendWithLabels } from "../api/types";
import { api, ApiError } from "../api/client";
import { listBlockedFriends, listFriendsWithLabels } from "../api/friends";
import { SkeletonList } from "../components/Skeleton";
import FriendRowMenu from "../components/FriendRowMenu";
import BlockedFriendsSection from "../components/BlockedFriendsSection";

export default function FriendsPage() {
  const [friends, setFriends] = useState<FriendWithLabels[]>([]);
  const [blocked, setBlocked] = useState<BlockedFriend[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [friendsData, blockedData] = await Promise.all([listFriendsWithLabels(), listBlockedFriends()]);
    setFriends(friendsData.friends);
    setBlocked(blockedData.blocked);
  }

  useEffect(() => {
    void load()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load friends."))
      .finally(() => setLoading(false));
  }, []);

  async function invite() {
    setCreating(true);
    setError(null);
    try {
      const data = await api.post<{ invite: { token: string; expiresAt: string } }>("/friends/invites");
      const url = `${window.location.origin}/invite/${data.invite.token}`;
      setInviteUrl(url);
      setInviteExpiresAt(data.invite.expiresAt);
      if (navigator.share) {
        try {
          await navigator.share({ title: "Join me on PlanBuddy", text: "Connect with me so our plans fit both of us.", url });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create an invite.");
    } finally {
      setCreating(false);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  function handleRemoved(userId: string) {
    setFriends((current) => current.filter((item) => item.userId !== userId));
  }

  function handleBlocked(userId: string) {
    const friend = friends.find((item) => item.userId === userId);
    setFriends((current) => current.filter((item) => item.userId !== userId));
    if (friend) {
      setBlocked((current) => [{ userId: friend.userId, email: friend.email, displayName: friend.displayName, blockedAt: new Date().toISOString() }, ...current]);
    }
  }

  function handleUnblocked(userId: string) {
    setBlocked((current) => current.filter((item) => item.userId !== userId));
  }

  function handleLabelsChanged(userId: string, labels: FriendLabel[]) {
    setFriends((current) => current.map((item) => (item.userId === userId ? { ...item, labels } : item)));
  }

  return (
    <div className="stack">
      <div><div className="eyebrow">Friends</div><h1>Plans that work for everyone.</h1><p>Invite people you plan with. When you select them, PlanBuddy uses their own verified needs and tastes without showing you their private memory.</p></div>
      {error && <div className="error-banner">{error}</div>}
      <section className="card invite-card">
        <div className="invite-card__icon"><UserPlus size={24} /></div>
        <div><h3>Invite a friend</h3><p>They open one private link, sign in or join, and the connection works both ways.</p></div>
        <button className="btn btn-primary" onClick={invite} disabled={creating}><Share2 size={16} /> {creating ? "Creating…" : "Send invite"}</button>
        {inviteUrl && (
          <div className="invite-link-box">
            <span>{inviteUrl}</span>
            <button className="btn btn-ghost btn-sm" onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}</button>
            {inviteExpiresAt && <small>Expires {new Date(inviteExpiresAt).toLocaleDateString()}</small>}
          </div>
        )}
      </section>
      {loading ? (
        <SkeletonList rows={2} lines={1} label="Loading friends" />
      ) : (
        <section className="card">
          <div className="section-header"><div><div className="eyebrow">Connected</div><h3>{friends.length} {friends.length === 1 ? "friend" : "friends"}</h3></div></div>
          {friends.length === 0 && <div className="empty-state">No connected friends yet. Your household members and pets still live in Memory.</div>}
          {friends.map((friend) => (
            <div className="friend-row" key={friend.userId}>
              <div className="friend-avatar">{friend.displayName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{friend.displayName}</strong>
                <span>{friend.email}</span>
                {friend.labels.length > 0 && (
                  <div className="pb-friend-labels">
                    {friend.labels.map((label) => (
                      <span className="pb-friend-label-chip" key={label.id}>{label.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <FriendRowMenu
                friend={friend}
                onRemoved={handleRemoved}
                onBlocked={handleBlocked}
                onLabelsChanged={handleLabelsChanged}
                onError={setError}
              />
            </div>
          ))}
        </section>
      )}
      <BlockedFriendsSection blocked={blocked} onUnblocked={handleUnblocked} onError={setError} />
    </div>
  );
}

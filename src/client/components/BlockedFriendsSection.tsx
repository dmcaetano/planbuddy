import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import type { BlockedFriend } from "../api/types";
import { unblockFriend } from "../api/friends";
import { ApiError } from "../api/client";
import "../styles/friends.css";

interface BlockedFriendsSectionProps {
  blocked: BlockedFriend[];
  onUnblocked: (userId: string) => void;
  onError: (message: string) => void;
}

/** Collapsed "Blocked" section — stays out of the way unless the user has actually blocked someone. */
export default function BlockedFriendsSection({ blocked, onUnblocked, onError }: BlockedFriendsSectionProps) {
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);

  if (blocked.length === 0) return null;

  async function unblock(userId: string) {
    setWorkingId(userId);
    try {
      await unblockFriend(userId);
      onUnblocked(userId);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't unblock that person.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section className="card pb-blocked-section">
      <button className="pb-blocked-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="eyebrow" style={{ marginBottom: 0 }}>Blocked</span>
        <span className="muted">{blocked.length}</span>
      </button>
      {open && (
        <div className="pb-blocked-list">
          {blocked.map((person) => (
            <div className="friend-row" key={person.userId}>
              <div className="friend-avatar">{person.displayName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{person.displayName}</strong>
                <span>{person.email}</span>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void unblock(person.userId)}
                disabled={workingId === person.userId}
              >
                <ShieldCheck size={15} /> {workingId === person.userId ? "Working…" : "Unblock"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

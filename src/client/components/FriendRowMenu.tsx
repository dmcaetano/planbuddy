import { useState } from "react";
import { MoreVertical, ShieldOff, Tags, UserMinus } from "lucide-react";
import type { FriendLabel, FriendWithLabels } from "../api/types";
import { blockFriend } from "../api/friends";
import { api, ApiError } from "../api/client";
import ConfirmDialog from "./ConfirmDialog";
import LabelEditor from "./LabelEditor";
import "../styles/friends.css";

interface FriendRowMenuProps {
  friend: FriendWithLabels;
  onRemoved: (userId: string) => void;
  onBlocked: (userId: string) => void;
  onLabelsChanged: (userId: string, labels: FriendLabel[]) => void;
  onError: (message: string) => void;
}

type Panel = "menu" | "labels" | "confirm-remove" | "confirm-block" | null;

/** The ⋯ row menu for a connected friend: edit circle labels, remove, or block. */
export default function FriendRowMenu({ friend, onRemoved, onBlocked, onLabelsChanged, onError }: FriendRowMenuProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);

  async function confirmRemove() {
    setBusy(true);
    try {
      await api.delete(`/friends/${friend.userId}`);
      onRemoved(friend.userId);
      setPanel(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't remove that friend.");
      setPanel(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlock() {
    setBusy(true);
    try {
      await blockFriend(friend.userId);
      onBlocked(friend.userId);
      setPanel(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't block that person.");
      setPanel(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-row-menu">
      <button className="icon-btn" onClick={() => setPanel(panel === "menu" ? null : "menu")} aria-label={`More actions for ${friend.displayName}`}>
        <MoreVertical size={18} />
      </button>

      {panel === "menu" && (
        <>
          <div className="pb-menu-scrim" onClick={() => setPanel(null)} role="presentation" />
          <div className="pb-menu" role="menu">
            <button role="menuitem" onClick={() => setPanel("labels")}>
              <Tags size={16} /> Edit labels
            </button>
            <button role="menuitem" onClick={() => setPanel("confirm-remove")}>
              <UserMinus size={16} /> Remove
            </button>
            <button role="menuitem" className="pb-menu-item-danger" onClick={() => setPanel("confirm-block")}>
              <ShieldOff size={16} /> Block
            </button>
          </div>
        </>
      )}

      {panel === "labels" && (
        <LabelEditor
          friend={friend}
          onClose={() => setPanel(null)}
          onSaved={(labels) => onLabelsChanged(friend.userId, labels)}
        />
      )}

      {panel === "confirm-remove" && (
        <ConfirmDialog
          title={`Remove ${friend.displayName}?`}
          body="They'll come off your friends list. Either of you can reconnect later with a new invite."
          confirmLabel="Remove"
          danger
          busy={busy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel === "confirm-block" && (
        <ConfirmDialog
          title={`Block ${friend.displayName}?`}
          body="This ends your connection and stops either of you from reconnecting until you unblock them. They won't be told they've been blocked."
          confirmLabel="Block"
          danger
          busy={busy}
          onConfirm={() => void confirmBlock()}
          onCancel={() => setPanel(null)}
        />
      )}
    </div>
  );
}

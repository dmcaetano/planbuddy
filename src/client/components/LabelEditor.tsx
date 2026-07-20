import { useState } from "react";
import { X } from "lucide-react";
import type { FriendLabel, FriendWithLabels } from "../api/types";
import { replaceFriendLabels } from "../api/friends";
import { ApiError } from "../api/client";

const PRESET_LABELS = ["Family", "Close friends"];
const MAX_LABEL_LENGTH = 24;

interface LabelEditorProps {
  friend: FriendWithLabels;
  onClose: () => void;
  onSaved: (labels: FriendLabel[]) => void;
}

/** Chip editor for a friend's circle labels: the two presets plus free-text custom entries. */
export default function LabelEditor({ friend, onClose, onSaved }: LabelEditorProps) {
  const [selected, setSelected] = useState<string[]>(friend.labels.map((label) => label.name));
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customChips = selected.filter((name) => !PRESET_LABELS.includes(name));
  const allChips = [...PRESET_LABELS, ...customChips];

  function toggle(name: string) {
    setSelected((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
  }

  function addCustom() {
    const name = customInput.trim();
    if (!name) return;
    if (name.length > MAX_LABEL_LENGTH) {
      setError(`Labels can be at most ${MAX_LABEL_LENGTH} characters.`);
      return;
    }
    setError(null);
    setSelected((current) => (current.includes(name) ? current : [...current, name]));
    setCustomInput("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await replaceFriendLabels(friend.userId, selected);
      onSaved(data.labels);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save labels.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pb-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="pb-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pb-label-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pb-modal-header">
          <h3 id="pb-label-editor-title">Labels for {friend.displayName}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p>Tap to toggle. A friend can carry more than one label.</p>
        <div className="chip-row pb-label-chip-row">
          {allChips.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip pb-label-chip ${selected.includes(name) ? "selected" : ""}`}
              onClick={() => toggle(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="pb-label-custom-row">
          <input
            className="pb-label-custom-input"
            type="text"
            placeholder="Custom label"
            maxLength={MAX_LABEL_LENGTH}
            value={customInput}
            onChange={(event) => setCustomInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustom();
              }
            }}
          />
          <button className="btn btn-ghost btn-sm" type="button" onClick={addCustom} disabled={!customInput.trim()}>
            Add
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="pb-modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save labels"}
          </button>
        </div>
      </div>
    </div>
  );
}

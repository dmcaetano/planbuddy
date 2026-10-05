import { useId, useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Participant } from "../api/types";
import "../styles/relationship.css";

export const RELATIONSHIP_SUGGESTIONS = [
  "wife", "husband", "partner", "mother", "father", "son", "daughter", "brother", "sister",
  "friend", "grandmother", "grandfather", "cousin", "colleague",
];

/**
 * Set / edit / clear the relationship of one local person or pet. Saves through the existing
 * PATCH /participants/:id route; clearing sends null. Not rendered for the owner or friend accounts.
 */
export default function RelationshipEditor({
  participant,
  onSaved,
}: {
  participant: Participant;
  onSaved: (participant: Participant) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const inputId = useId();

  if (participant.isOwner || participant.isFriendAccount) return null;

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.patch<{ participant: Participant }>(`/participants/${participant.id}`, { relationship: value });
      onSaved(data.participant);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the relationship. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function begin() {
    setDraft(participant.relationship ?? "");
    setError(null);
    setEditing(true);
  }

  return (
    <div className="rel-editor">
      {participant.relationship ? (
        <span className="badge badge-sky" data-testid="relationship-value">{participant.relationship}</span>
      ) : (
        <span className="rel-editor__label">No relationship set</span>
      )}
      {!editing && (
        <button
          type="button"
          className="btn btn-ghost btn-sm rel-editor__trigger"
          onClick={begin}
          aria-label={`${participant.relationship ? "Edit" : "Set"} relationship for ${participant.name}`}
        >
          {participant.relationship ? <Pencil size={14} /> : <Plus size={14} />}
          {participant.relationship ? "Edit" : "Set"}
        </button>
      )}
      {editing && (
        <form
          className="rel-editor__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft.trim() === "" ? null : draft.trim());
          }}
        >
          <label className="sr-only" htmlFor={inputId}>Relationship of {participant.name}</label>
          <input
            id={inputId}
            list={listId}
            value={draft}
            maxLength={120}
            autoFocus
            placeholder="e.g. wife, friend, mother"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}
          />
          <datalist id={listId}>
            {RELATIONSHIP_SUGGESTIONS.map((word) => <option key={word} value={word} />)}
          </datalist>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-label={`Save relationship for ${participant.name}`}>
            <Check size={14} /> Save
          </button>
          {participant.relationship && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(null)} aria-label={`Clear relationship for ${participant.name}`}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)} aria-label="Cancel">
            <X size={14} />
          </button>
          {error && <div className="rel-editor__error" role="alert">{error}</div>}
        </form>
      )}
    </div>
  );
}

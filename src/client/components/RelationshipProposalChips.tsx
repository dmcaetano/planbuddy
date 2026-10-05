import { useState } from "react";
import { Check, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Participant } from "../api/types";
import "../styles/relationship.css";

export interface RelationshipProposal {
  action: "set" | "add";
  participantId: string | null;
  name: string;
  relationship: string;
  previousRelationship: string | null;
}

/** One-tap confirm / decline for a Buddy-proposed relationship. Nothing is saved until the confirm tap. */
export default function RelationshipProposalChips({
  proposal,
  onResolved,
}: {
  proposal: RelationshipProposal;
  onResolved?: (outcome: "saved" | "declined", participant?: Participant) => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "declined">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("saving");
    setError(null);
    try {
      const data = await api.post<{ participant: Participant }>("/chat/confirm-relationship", {
        participantId: proposal.participantId ?? undefined,
        name: proposal.name,
        relationship: proposal.relationship,
      });
      setState("saved");
      onResolved?.("saved", data.participant);
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    }
  }

  if (state === "saved") {
    return <div className="buddy-message buddy-message--assistant" role="status">Saved: {proposal.name} is your {proposal.relationship}.</div>;
  }
  if (state === "declined") {
    return <div className="buddy-message buddy-message--assistant" role="status">No change made.</div>;
  }
  return (
    <div className="buddy-chips" role="group" aria-label={`Confirm ${proposal.name} is your ${proposal.relationship}`}>
      <button type="button" className="buddy-chip buddy-chip--confirm" disabled={state === "saving"} onClick={() => void confirm()}>
        <Check size={14} /> {proposal.action === "add" ? `Add ${proposal.name} as ${proposal.relationship}` : `Save: ${proposal.name} is my ${proposal.relationship}`}
      </button>
      <button
        type="button"
        className="buddy-chip buddy-chip--decline"
        disabled={state === "saving"}
        onClick={() => { setState("declined"); onResolved?.("declined"); }}
      >
        <X size={14} /> Not now
      </button>
      {error && <div className="rel-editor__error" role="alert">{error}</div>}
    </div>
  );
}

import { useState } from "react";
import { Check, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { TimeOff, TimeOffProposal } from "@shared/momentTypes";
import "../styles/relationship.css";

/** One-tap confirm / decline for a Buddy-proposed time-off range. Nothing is saved until the confirm tap. */
export default function TimeOffProposalChips({
  proposal,
  onResolved,
}: {
  proposal: TimeOffProposal;
  onResolved?: (outcome: "saved" | "declined", timeOff?: TimeOff) => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "declined">("idle");
  const [error, setError] = useState<string | null>(null);
  const summary = `${proposal.label}, ${proposal.startDate} to ${proposal.endDate}`;

  async function confirm() {
    setState("saving");
    setError(null);
    try {
      const data = await api.post<{ timeOff: TimeOff }>("/chat/confirm-time-off", proposal);
      setState("saved");
      onResolved?.("saved", data.timeOff);
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    }
  }

  if (state === "saved") {
    return <div className="buddy-message buddy-message--assistant" role="status">Saved to Time off: {summary}.</div>;
  }
  if (state === "declined") {
    return <div className="buddy-message buddy-message--assistant" role="status">No change made.</div>;
  }
  return (
    <div className="buddy-chips" role="group" aria-label={`Confirm time off ${summary}`}>
      <button type="button" className="buddy-chip buddy-chip--confirm" disabled={state === "saving"} onClick={() => void confirm()}>
        <Check size={14} /> Save time off: {proposal.startDate} to {proposal.endDate}
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

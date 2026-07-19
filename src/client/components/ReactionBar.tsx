import { useState } from "react";
import { Heart, ThumbsDown, ThumbsUp } from "lucide-react";
import type { FeatureSummary, Reaction } from "../api/types";
import { api, ApiError } from "../api/client";

export default function ReactionBar({
  specId,
  candidateId,
  onDislike,
}: {
  specId: string;
  candidateId: string;
  onDislike: () => void;
}) {
  const [selected, setSelected] = useState<Reaction | null>(null);
  const [learned, setLearned] = useState<FeatureSummary | null>(null);
  const [working, setWorking] = useState<Reaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function react(reaction: "like" | "love") {
    setWorking(reaction);
    setError(null);
    try {
      const data = await api.post<{
        reaction: { reaction: Reaction };
        learned: FeatureSummary | null;
      }>(`/plan-specs/${specId}/react`, { candidateId, reaction });
      setSelected(data.reaction.reaction);
      setLearned(data.learned?.summary ? data.learned : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that reaction.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="reaction-card" aria-label="Rate this suggestion">
      <div className="reaction-card__copy">
        <strong>Does this feel like you?</strong>
        <span>Love teaches PlanBuddy the reusable parts—not just the venue.</span>
      </div>
      <div className="reaction-buttons">
        <button
          className={`reaction-button reaction-button--dislike ${selected === "dislike" ? "selected" : ""}`}
          onClick={() => { setSelected("dislike"); setLearned(null); onDislike(); }}
        >
          <ThumbsDown size={17} /> Dislike
        </button>
        <button className={`reaction-button ${selected === "like" ? "selected" : ""}`} onClick={() => void react("like")} disabled={working !== null}>
          <ThumbsUp size={17} /> {working === "like" ? "Saving…" : "Like"}
        </button>
        <button className={`reaction-button reaction-button--love ${selected === "love" ? "selected" : ""}`} onClick={() => void react("love")} disabled={working !== null}>
          <Heart size={17} fill={selected === "love" ? "currentColor" : "none"} /> {working === "love" ? "Learning…" : "Love"}
        </button>
      </div>
      {learned && (
        <div className="learned-panel" role="status">
          <div className="eyebrow">PlanBuddy learned</div>
          <p>{learned.summary}</p>
          <div className="chip-row">
            {learned.features.map((feature) => <span className="learned-chip" key={feature}>{feature}</span>)}
          </div>
          <small>You can review or remove these hunches in Memory.</small>
        </div>
      )}
      {error && <small className="inline-error">{error}</small>}
    </section>
  );
}

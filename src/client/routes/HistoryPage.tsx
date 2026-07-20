import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Candidate, FeatureSummary, PlanRecord, PlanView, Reaction } from "../api/types";
import { Heart, Lock, ThumbsDown, ThumbsUp } from "lucide-react";
import TicketCard from "../components/TicketCard";
import ShareButton from "../components/ShareButton";
import ReactionBar from "../components/ReactionBar";
import { SkeletonList } from "../components/Skeleton";

function PlanRow({ plan, onOpen }: { plan: PlanRecord; onOpen: () => void }) {
  const statusLabel = plan.status === "locked" ? "Locked" : plan.status === "suggested" ? "Saved suggestion" : "Disliked";
  return (
    <button className="card card-btn" onClick={onOpen}>
      <div className="row mb-1">
        <span className={`badge ${plan.status === "locked" ? "badge-pine" : plan.status === "suggested" ? "badge-sky" : "badge-clay"}`}>{statusLabel}</span>
        <span className="badge badge-sky">{plan.category}</span>
      </div>
      <strong>{plan.title}</strong>
      <p className="muted mb-0">
        {new Date(`${plan.eventStartDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
      </p>
    </button>
  );
}

function FeedbackForm({ planId, onDone }: { planId: string; onDone: (learned: FeatureSummary | null) => void }) {
  const [reaction, setReaction] = useState<Reaction>("like");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const data = await api.post<{ learned: FeatureSummary | null }>(`/history/${planId}/feedback`, {
        reaction,
        comment: comment.trim() || null,
      });
      onDone(data.learned?.summary ? data.learned : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="eyebrow">How did it feel?</div>
      <p>Love saves the reusable features that made this plan special.</p>
      <div className="reaction-buttons mb-3">
        <button className={`reaction-button reaction-button--dislike ${reaction === "dislike" ? "selected" : ""}`} onClick={() => setReaction("dislike")}>
          <ThumbsDown size={17} /> Dislike
        </button>
        <button className={`reaction-button ${reaction === "like" ? "selected" : ""}`} onClick={() => setReaction("like")}>
          <ThumbsUp size={17} /> Like
        </button>
        <button className={`reaction-button reaction-button--love ${reaction === "love" ? "selected" : ""}`} onClick={() => setReaction("love")}>
          <Heart size={17} fill={reaction === "love" ? "currentColor" : "none"} /> Love
        </button>
      </div>
      <textarea className="wide-textarea" placeholder="Optional: what worked or missed?" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
      {error && <div className="error-banner">{error}</div>}
      <button className="btn btn-primary" onClick={submit} disabled={submitting}>{submitting ? "Saving…" : "Save feedback"}</button>
    </div>
  );
}

export default function HistoryPage() {
  const [suggested, setSuggested] = useState<PlanRecord[]>([]);
  const [upcoming, setUpcoming] = useState<PlanRecord[]>([]);
  const [past, setPast] = useState<PlanRecord[]>([]);
  const [selected, setSelected] = useState<PlanRecord | null>(null);
  const [selectedView, setSelectedView] = useState<PlanView | null>(null);
  const [selectedReaction, setSelectedReaction] = useState<Reaction | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [learned, setLearned] = useState<FeatureSummary | null>(null);
  const [locking, setLocking] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const data = await api.get<{ suggested: PlanRecord[]; upcoming: PlanRecord[]; past: PlanRecord[] }>("/history");
    setSuggested(data.suggested);
    setUpcoming(data.upcoming);
    setPast(data.past);
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load History."))
      .finally(() => setLoading(false));
  }, []);

  async function openPlan(plan: PlanRecord) {
    setSelected(plan);
    setSelectedView(null);
    setSelectedReaction(null);
    setDetailsLoading(true);
    try {
      const [data, detail] = await Promise.all([
        api.get<{ candidates: Candidate[] }>(`/plan-specs/${plan.planSpecId}`),
        api.get<{ reaction: { reaction: Reaction } | null }>(`/history/${plan.id}`),
      ]);
      setSelectedReaction(detail.reaction?.reaction ?? null);
      const candidate = data.candidates.find((item) => item.id === plan.candidateId);
      if (candidate) {
        setSelectedView({
          candidate,
          weather: plan.weather ?? { temperatureC: null, precipitationProbability: null, summary: "Forecast unavailable", unavailable: true },
          placeProvenance: plan.placeProvenance,
          activeConstraints: plan.activeConstraints,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the full itinerary.");
    } finally {
      setDetailsLoading(false);
    }
  }

  async function lockSelected() {
    if (!selected) return;
    setLocking(true);
    setError(null);
    try {
      const data = await api.post<{ plan: PlanRecord }>(`/plan-specs/${selected.planSpecId}/lock`, {
        candidateId: selected.candidateId,
      });
      setSelected(data.plan);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't lock this suggestion.");
    } finally {
      setLocking(false);
    }
  }

  if (selected) {
    return (
      <div className="stack">
        <div className="history-detail-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(null); setSelectedView(null); setFeedbackDone(false); setLearned(null); }}>← Back to History</button>
          <div className="row-gap">
            {selected.status !== "locked" && (
              <button className="btn btn-primary btn-sm" onClick={() => void lockSelected()} disabled={locking}>
                <Lock size={15} /> {locking ? "Lockingâ€¦" : "Lock it"}
              </button>
            )}
            {selectedView && <ShareButton candidateId={selected.candidateId} compact />}
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {detailsLoading && <div className="skeleton" style={{ height: 320, borderRadius: 18 }} />}
        {selectedView ? (
          <TicketCard view={selectedView} eventStartDate={selected.eventStartDate} eventEndDate={selected.eventEndDate} />
        ) : !detailsLoading && (
          <div className="card">
            <div className="eyebrow">{selected.category}</div>
            <h2>{selected.title}</h2>
            <p>{selected.rationale}</p>
            {selected.beats.map((beat, index) => <div className="beat" key={index}><h4>{beat.title}</h4><p>{beat.description}</p></div>)}
            {selected.rejectionReason && <p className="muted">Not chosen: {selected.rejectionReason}</p>}
          </div>
        )}
        {selected.status !== "locked" && (
          <ReactionBar
            key={selected.candidateId}
            specId={selected.planSpecId}
            candidateId={selected.candidateId}
            initialReaction={selectedReaction}
          />
        )}
        {selected.status === "locked" && !feedbackDone && <FeedbackForm planId={selected.id} onDone={(summary) => { setFeedbackDone(true); setLearned(summary); }} />}
        {feedbackDone && (
          <div className="learned-panel">
            <div className="eyebrow">Saved</div>
            <p>{learned?.summary ?? "Thanks—that reaction will improve future suggestions."}</p>
            {learned && <div className="chip-row">{learned.features.map((feature) => <span className="learned-chip" key={feature}>{feature}</span>)}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div><div className="eyebrow">History</div><h1>Your plans</h1><p>Every suggestion stays here. Reopen it, rate it, or lock it whenever you want.</p></div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <SkeletonList rows={4} lines={1} label="Loading history" />
      ) : (
        <>
          <h3>Upcoming</h3>
          {upcoming.length === 0 && <div className="empty-state">Nothing locked yet — open a suggestion below and lock it in when it's right.</div>}
          <div className="stack">{upcoming.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={() => void openPlan(plan)} />)}</div>
          <h3>Saved suggestions</h3>
          {suggested.length === 0 && <div className="empty-state">New suggestions will appear here automatically.</div>}
          <div className="stack">{suggested.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={() => void openPlan(plan)} />)}</div>
          <h3>Past & disliked</h3>
          {past.length === 0 && <div className="empty-state">Nothing here yet.</div>}
          <div className="stack">{past.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={() => void openPlan(plan)} />)}</div>
        </>
      )}
    </div>
  );
}

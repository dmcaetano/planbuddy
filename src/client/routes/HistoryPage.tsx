import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Candidate, FeatureSummary, PlanRecord, PlanView, Reaction } from "../api/types";
import { Heart, ThumbsDown, ThumbsUp } from "lucide-react";
import TicketCard from "../components/TicketCard";
import ShareButton from "../components/ShareButton";

function PlanRow({ plan, onOpen }: { plan: PlanRecord; onOpen: () => void }) {
  return (
    <button className="card" style={{ textAlign: "left", width: "100%", border: "1px solid var(--hairline)" }} onClick={onOpen}>
      <div className="row-gap" style={{ marginBottom: 4 }}>
        <span className={`badge ${plan.status === "locked" ? "badge-pine" : "badge-clay"}`}>{plan.status === "locked" ? "Locked" : "Not chosen"}</span>
        <span className="badge badge-sky">{plan.category}</span>
      </div>
      <strong>{plan.title}</strong>
      <p className="muted" style={{ marginBottom: 0 }}>
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
      <div className="reaction-buttons" style={{ marginBottom: 12 }}>
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
  const [upcoming, setUpcoming] = useState<PlanRecord[]>([]);
  const [past, setPast] = useState<PlanRecord[]>([]);
  const [selected, setSelected] = useState<PlanRecord | null>(null);
  const [selectedView, setSelectedView] = useState<PlanView | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [learned, setLearned] = useState<FeatureSummary | null>(null);

  async function load() {
    const data = await api.get<{ upcoming: PlanRecord[]; past: PlanRecord[] }>("/history");
    setUpcoming(data.upcoming);
    setPast(data.past);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load History."));
  }, []);

  async function openPlan(plan: PlanRecord) {
    setSelected(plan);
    setSelectedView(null);
    setDetailsLoading(true);
    try {
      const data = await api.get<{ candidates: Candidate[] }>(`/plan-specs/${plan.planSpecId}`);
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

  if (selected) {
    return (
      <div className="stack">
        <div className="history-detail-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(null); setSelectedView(null); setFeedbackDone(false); setLearned(null); }}>← Back to History</button>
          {selectedView && <ShareButton candidateId={selected.candidateId} compact />}
        </div>
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
      <div><div className="eyebrow">History</div><h1>Your plans</h1><p>Upcoming and past plans, and the source of novelty for future recommendations.</p></div>
      {error && <div className="error-banner">{error}</div>}
      <h3>Upcoming</h3>
      {upcoming.length === 0 && <p className="muted">Nothing locked yet.</p>}
      <div className="stack">{upcoming.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={() => void openPlan(plan)} />)}</div>
      <h3>Past</h3>
      {past.length === 0 && <p className="muted">Nothing here yet.</p>}
      <div className="stack">{past.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={() => void openPlan(plan)} />)}</div>
    </div>
  );
}

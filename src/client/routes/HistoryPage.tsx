import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { PlanRecord } from "../api/types";
import { Star, ThumbsDown, ThumbsUp } from "lucide-react";

function PlanRow({ plan, onOpen }: { plan: PlanRecord; onOpen: () => void }) {
  return (
    <button className="card" style={{ textAlign: "left", width: "100%", border: "1px solid var(--hairline)" }} onClick={onOpen}>
      <div className="row-gap" style={{ marginBottom: 4 }}>
        <span className={`badge ${plan.status === "locked" ? "badge-pine" : "badge-clay"}`}>
          {plan.status === "locked" ? "Locked" : "Not chosen"}
        </span>
        <span className="badge badge-sky">{plan.category}</span>
      </div>
      <strong>{plan.title}</strong>
      <p className="muted" style={{ marginBottom: 0 }}>
        {new Date(plan.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </p>
    </button>
  );
}

function FeedbackForm({ planId, onDone }: { planId: string; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await api.post(`/history/${planId}/feedback`, { rating, comment: comment.trim() || null });
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="eyebrow">Leave feedback</div>
      <div className="row-gap" style={{ marginBottom: 8 }}>
        <button
          className={`chip ${rating >= 4 ? "selected" : ""}`}
          onClick={() => setRating(5)}
          aria-label="Thumbs up"
        >
          <ThumbsUp size={16} /> Good pick
        </button>
        <button
          className={`chip ${rating <= 2 ? "selected" : ""}`}
          onClick={() => setRating(1)}
          aria-label="Thumbs down"
        >
          <ThumbsDown size={16} /> Missed the mark
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 6 }}>Or fine-tune the rating:</p>
      <div className="row-gap" style={{ marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="icon-btn" onClick={() => setRating(n)} aria-label={`${n} stars`}>
            <Star size={20} fill={n <= rating ? "var(--honey)" : "none"} color="var(--honey)" />
          </button>
        ))}
      </div>
      <textarea
        placeholder="Optional comment…"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        style={{ width: "100%", border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: 10, marginBottom: 8 }}
      />
      <button className="btn btn-primary" onClick={submit} disabled={submitting}>
        Submit feedback
      </button>
    </div>
  );
}

export default function HistoryPage() {
  const [upcoming, setUpcoming] = useState<PlanRecord[]>([]);
  const [past, setPast] = useState<PlanRecord[]>([]);
  const [selected, setSelected] = useState<PlanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackDone, setFeedbackDone] = useState(false);

  async function load() {
    const data = await api.get<{ upcoming: PlanRecord[]; past: PlanRecord[] }>("/history");
    setUpcoming(data.upcoming);
    setPast(data.past);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load History."));
  }, []);

  if (selected) {
    return (
      <div className="stack">
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => { setSelected(null); setFeedbackDone(false); }}>
          ← Back to History
        </button>
        <div className="card">
          <div className="eyebrow">{selected.category}</div>
          <h2>{selected.title}</h2>
          <p>{selected.rationale}</p>
          {selected.beats.map((b, i) => (
            <div className="beat" key={i}>
              <h4>{b.title}</h4>
              <p>{b.description}</p>
            </div>
          ))}
          {selected.rejectionReason && <p className="muted">Not chosen: {selected.rejectionReason}</p>}
        </div>
        {selected.status === "locked" && !feedbackDone && (
          <FeedbackForm planId={selected.id} onDone={() => setFeedbackDone(true)} />
        )}
        {feedbackDone && <div className="hint-banner">Thanks — that feedback helps PlanBuddy learn safely.</div>}
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">History</div>
        <h1>Your plans</h1>
        <p>Upcoming and past plans, and the source of novelty for future recommendations.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <h3>Upcoming</h3>
      {upcoming.length === 0 && <p className="muted">Nothing locked yet.</p>}
      <div className="stack">
        {upcoming.map((p) => (
          <PlanRow key={p.id} plan={p} onOpen={() => setSelected(p)} />
        ))}
      </div>

      <h3>Past</h3>
      {past.length === 0 && <p className="muted">Nothing here yet.</p>}
      <div className="stack">
        {past.map((p) => (
          <PlanRow key={p.id} plan={p} onOpen={() => setSelected(p)} />
        ))}
      </div>
    </div>
  );
}

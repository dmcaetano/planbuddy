import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Participant, PlanView } from "../api/types";
import type { PipelineResponse } from "../api/types";
import { SCALE_LABELS, SCALE_RADIUS_KM, type Scale } from "@shared/scale";
import TicketCard from "../components/TicketCard";
import { PawPrint, User, ThumbsDown, Lock, RefreshCw, SlidersHorizontal } from "lucide-react";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type ViewState = "spec" | "generating" | "browsing" | "locked" | "deadEnd" | "error";

export default function PlanPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [scale, setScale] = useState<Scale>("day_off");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moodContext, setMoodContext] = useState("");

  const [state, setState] = useState<ViewState>("spec");
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [notThisOpen, setNotThisOpen] = useState(false);
  const [notThisReason, setNotThisReason] = useState("");
  const [lockedPlanId, setLockedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looseners, setLooseners] = useState<string[] | null>(null);

  useEffect(() => {
    api.get<{ participants: Participant[] }>("/participants").then((d) => {
      setParticipants(d.participants);
      setSelectedIds(d.participants.map((p) => p.id));
    });
  }, []);

  useEffect(() => {
    setEndDate((prev) => (prev < startDate ? startDate : prev));
  }, [startDate]);

  const displayQueue: PlanView[] = useMemo(() => {
    if (!result || !result.winner) return [];
    return [result.winner, ...result.alternates];
  }, [result]);

  const current = displayQueue[displayIndex] ?? null;

  async function planIt() {
    setError(null);
    setLooseners(null);
    setState("generating");
    try {
      const data = await api.post<PipelineResponse>("/plan-specs", {
        scale,
        startDate,
        endDate,
        participantIds: selectedIds,
        moodContext: moodContext.trim() || null,
      });
      setResult(data);
      setDisplayIndex(0);
      setState(data.deadEnd ? "deadEnd" : "browsing");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach PlanBuddy. Please try again.");
      setState("error");
    }
  }

  async function showAnother() {
    if (!result) return;
    if (displayIndex + 1 < displayQueue.length) {
      setDisplayIndex((i) => i + 1);
      return;
    }
    setError(null);
    setState("generating");
    try {
      const data = await api.post<PipelineResponse>(`/plan-specs/${result.spec.id}/regenerate`);
      if (data.looseners) {
        setLooseners(data.looseners);
        setState("browsing");
        return;
      }
      setResult(data);
      setDisplayIndex(0);
      setState(data.deadEnd ? "deadEnd" : "browsing");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach PlanBuddy. Please try again.");
      setState("error");
    }
  }

  async function submitNotThis() {
    if (!result || !current) return;
    try {
      await api.post(`/plan-specs/${result.spec.id}/not-this`, {
        candidateId: current.candidate.id,
        reason: notThisReason.trim() || "Not a fit right now",
      });
      setNotThisOpen(false);
      setNotThisReason("");
      await showAnother();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that. Please try again.");
    }
  }

  async function lockIt() {
    if (!result || !current) return;
    setError(null);
    try {
      const data = await api.post<{ plan: { id: string } }>(`/plan-specs/${result.spec.id}/lock`, {
        candidateId: current.candidate.id,
      });
      setLockedPlanId(data.plan.id);
      setState("locked");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't lock this plan. Please try again.");
    }
  }

  function startOver() {
    setState("spec");
    setResult(null);
    setDisplayIndex(0);
    setLooseners(null);
    setError(null);
  }

  function toggleParticipant(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  if (state === "locked" && lockedPlanId) {
    return (
      <div className="stack">
        <div className="card">
          <div className="eyebrow">Locked</div>
          <h1>It's on the calendar.</h1>
          <p>Your plan is saved to History. Rate it afterward to help PlanBuddy learn.</p>
          <div className="row-gap">
            <Link to="/history" className="btn btn-secondary">
              View in History
            </Link>
            <button className="btn btn-ghost" onClick={startOver}>
              Plan something else
            </button>
          </div>
        </div>
        {current && <TicketCard view={current} />}
      </div>
    );
  }

  if (state === "generating") {
    return (
      <div className="stack">
        <div className="card">
          <div className="eyebrow">Generating</div>
          <h2>Finding your plan…</h2>
          <p className="muted">Reading memory, weather, and recent history to pick one confident option.</p>
        </div>
        <div className="skeleton" style={{ height: 220, borderRadius: 14 }} />
      </div>
    );
  }

  if (state === "browsing" || state === "deadEnd") {
    return (
      <div className="stack">
        {error && <div className="error-banner">{error}</div>}
        {looseners && (
          <div className="hint-banner">
            <strong>No more fresh batches for this plan.</strong> Try: {looseners.join(" · ")}
          </div>
        )}

        {state === "deadEnd" || !current ? (
          <div className="card">
            <div className="eyebrow">Dead end</div>
            <h2>Nothing cleared your constraints this time.</h2>
            <p>
              {result?.deadEndReasons?.length
                ? `Every candidate was rejected: ${result.deadEndReasons.slice(0, 3).join("; ")}.`
                : "Try loosening the radius, dates, or a soft preference."}
            </p>
            <button className="btn btn-primary" onClick={startOver}>
              Adjust and try again
            </button>
          </div>
        ) : (
          <>
            <TicketCard view={current} />
            <div className="row-gap">
              <button className="btn btn-primary" onClick={lockIt}>
                <Lock size={16} /> Lock it
              </button>
              <button className="btn btn-secondary" onClick={showAnother}>
                <RefreshCw size={16} /> Show another
              </button>
              <button className="btn btn-danger-ghost" onClick={() => setNotThisOpen(true)}>
                <ThumbsDown size={16} /> Not this
              </button>
              <button className="btn btn-ghost" onClick={startOver}>
                <SlidersHorizontal size={16} /> Tweak
              </button>
            </div>
            {notThisOpen && (
              <div className="card">
                <label htmlFor="not-this-reason" style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  Why isn't this the one? (helps PlanBuddy learn)
                </label>
                <textarea
                  id="not-this-reason"
                  rows={2}
                  value={notThisReason}
                  onChange={(e) => setNotThisReason(e.target.value)}
                  style={{ width: "100%", marginTop: 8, border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: 10 }}
                />
                <div className="row-gap" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={submitNotThis}>
                    Submit
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setNotThisOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // state === 'spec' | 'error'
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Plan</div>
        <h1>What should we do?</h1>
        <p>Pick a scale, who's in, and press Plan it.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="field">
          <label>Scale</label>
          <div className="chip-row">
            {(Object.keys(SCALE_LABELS) as Scale[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip ${scale === s ? "selected" : ""}`}
                onClick={() => setScale(s)}
              >
                {SCALE_LABELS[s]}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            Default radius: {SCALE_RADIUS_KM[scale]} km
          </p>
        </div>

        <div className="row-gap">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="start">Start</label>
            <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="end">End</label>
            <input id="end" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Who's in</label>
          <div className="chip-row">
            {participants.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${selectedIds.includes(p.id) ? "selected" : ""}`}
                onClick={() => toggleParticipant(p.id)}
              >
                {p.kind === "pet" ? <PawPrint size={14} /> : <User size={14} />} {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="mood">Optional context</label>
          <textarea
            id="mood"
            rows={2}
            placeholder="e.g. keep it low-key, someone's a bit tired"
            value={moodContext}
            onChange={(e) => setMoodContext(e.target.value)}
          />
        </div>

        <button className="btn btn-primary btn-block" onClick={planIt} disabled={selectedIds.length === 0}>
          Plan it
        </button>
      </div>
    </div>
  );
}

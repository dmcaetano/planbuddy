import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Participant, PlanView, PipelineResponse } from "../api/types";
import TicketCard from "./TicketCard";
import ReactionBar from "./ReactionBar";
import ShareButton from "./ShareButton";
import PlanEditChat from "./PlanEditChat";
import GenerationProgress from "./GenerationProgress";
import { useGeneration } from "../state/GenerationContext";
import { usePlanFocus } from "../state/PlanFocusContext";
import { Bot, Lock, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, X } from "lucide-react";

type BrowserState = "browsing" | "locked" | "deadEnd";

export interface PlanBrowserProps {
  /** The plan to browse. Re-key the component (by spec id) to browse a different plan. */
  initial: PipelineResponse;
  participants: Participant[];
  /** Called after local state is reset, when the user taps "Start over" / the dead-end action. */
  onStartOver: () => void;
  /** Label for the start-over / "do something else" actions. Defaults to the Customize flow wording. */
  startOverLabel?: string;
  /** Rendered at the top of the browsing view (e.g. Home's reason line). */
  header?: ReactNode;
  /** When set, the browser opens on the locked view for this plan (Home shows a locked plan covering the moment). */
  initialLockedPlanId?: string | null;
}

/**
 * The plan browsing / locking / revising experience, shared by the Customize page and Home.
 * Owns everything from the displayed queue through lock, show another, "not this", Tweak, the Buddy
 * editor and the original/revision comparison. The caller owns how the first plan arrives and what
 * "start over" means.
 */
export default function PlanBrowser({ initial, participants, onStartOver, startOverLabel, header, initialLockedPlanId }: PlanBrowserProps) {
  const generation = useGeneration();
  const { setFocusedPlan } = usePlanFocus();

  const [state, setState] = useState<BrowserState>(initialLockedPlanId ? "locked" : initial.deadEnd ? "deadEnd" : "browsing");
  const [result, setResult] = useState<PipelineResponse>(initial);
  const [otherVersion, setOtherVersion] = useState<PipelineResponse | null>(null);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [notThisOpen, setNotThisOpen] = useState(false);
  const [notThisReason, setNotThisReason] = useState("");
  const [lockedPlanId, setLockedPlanId] = useState<string | null>(initialLockedPlanId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [looseners, setLooseners] = useState<string[] | null>(null);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakRequest, setTweakRequest] = useState("");
  const [tweakSubmitting, setTweakSubmitting] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatThreadSpecId, setChatThreadSpecId] = useState<string | null>(initial.spec.id);

  // The fold below must not undo a lock the person made while a regenerate was still in flight.
  const stateRef = useRef(state);
  stateRef.current = state;

  const actionLabel = startOverLabel ?? "Start over";

  const displayQueue: PlanView[] = useMemo(() => {
    if (!result.winner) return [];
    return [result.winner, ...result.alternates];
  }, [result]);
  const current = displayQueue[displayIndex] ?? null;

  useEffect(() => {
    if (state === "browsing" && current) {
      setFocusedPlan({ specId: chatThreadSpecId ?? result.spec.id, candidate: current.candidate });
    } else {
      setFocusedPlan(null);
    }
  }, [chatThreadSpecId, current, result, setFocusedPlan, state]);

  useEffect(() => () => setFocusedPlan(null), [setFocusedPlan]);

  useEffect(() => {
    function onLocked(event: Event) {
      const detail = (event as CustomEvent<{ planId?: string }>).detail;
      if (!detail?.planId) return;
      setLockedPlanId(detail.planId);
      setState("locked");
    }
    window.addEventListener("planbuddy:locked", onLocked);
    return () => window.removeEventListener("planbuddy:locked", onLocked);
  }, []);

  // A terminal job that was already sitting in the provider when this browser mounted belongs to
  // whoever mounted us (they folded it into `initial`); only jobs that finish afterwards are ours.
  const appliedJobIdRef = useRef<string | null>(
    generation.job && (generation.job.status === "succeeded" || generation.job.status === "failed") ? generation.job.jobId : null
  );

  // Runs synchronously before paint so a just-finished job never flashes the stale view for a frame.
  // Buddy edits use the same job lifecycle as a regenerate but retain the exact prior plan as a
  // reversible comparison.
  useLayoutEffect(() => {
    const job = generation.job;
    if (!job || (job.status !== "succeeded" && job.status !== "failed")) return;
    if (job.kind !== "regenerate" && job.kind !== "edit") return;
    if (appliedJobIdRef.current === job.jobId) return;
    appliedJobIdRef.current = job.jobId;

    // Failures stay visible via GenerationProgress (with Retry) until the user retries or dismisses.
    if (job.status === "failed") return;

    if (stateRef.current === "locked") {
      generation.markSeen();
      return;
    }

    if (job.result) {
      const data = job.result;
      if (data.looseners) {
        setLooseners(data.looseners);
        setState("browsing");
      } else if (job.kind === "edit") {
        setOtherVersion(result);
        setResult(data);
        setDisplayIndex(0);
        setState(data.deadEnd ? "deadEnd" : "browsing");
      } else {
        setResult(data);
        setChatThreadSpecId(data.spec.id);
        setOtherVersion(null);
        setDisplayIndex(0);
        setState(data.deadEnd ? "deadEnd" : "browsing");
      }
    }
    generation.markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.job]);

  async function showAnother() {
    if (displayIndex + 1 < displayQueue.length) {
      setDisplayIndex((index) => index + 1);
      return;
    }
    setError(null);
    try {
      await generation.startRegenerate(result.spec.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach PlanBuddy. Please try again.");
    }
  }

  async function submitNotThis() {
    if (!current) return;
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
    if (!current) return;
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

  // The Tweak panel sends a free-text request through the same synchronous chat-action endpoint
  // PlanEditChat uses (an AI-interpreted action dispatch, not the async plan-generation pipeline),
  // so this stays a plain request/response call rather than a tracked job.
  async function submitTweak() {
    if (!current) return;
    setTweakSubmitting(true);
    setTweakError(null);
    try {
      const data = await api.post<{ jobId?: string | null; jobSpecId?: string | null; jobKind?: "edit" | "regenerate" | null; revision: PipelineResponse | null; assistantMessage: { content: string } }>(`/plan-specs/${chatThreadSpecId ?? result.spec.id}/chat-action`, {
        candidateId: current.candidate.id,
        message: tweakRequest.trim(),
      });
      if (data.jobId) {
        generation.trackJob(data.jobId, data.jobKind === "regenerate" ? "regenerate" : "edit", data.jobSpecId ?? result.spec.id);
        setTweakOpen(false);
        setTweakRequest("");
        return;
      }
      if (!data.revision?.winner) {
        setTweakError(data.assistantMessage.content || "I couldn't find a safe revision. Your current plan is still right here.");
        return;
      }
      applyRevision(data.revision);
      setTweakOpen(false);
      setTweakRequest("");
    } catch (err) {
      setTweakError(
        `${err instanceof ApiError ? err.message : "Couldn't build that revision."} Your current plan has not changed.`
      );
    } finally {
      setTweakSubmitting(false);
    }
  }

  function applyRevision(revision: PipelineResponse) {
    if (!revision.winner) return;
    setOtherVersion(result);
    setResult(revision);
    setDisplayIndex(0);
    setState("browsing");
    // A synchronous tweak (submitTweak, or PlanEditChat's onRevision) just moved local state onto a
    // newer child spec. If a previously-tracked generate/regenerate job is still sitting around in a
    // terminal state, it must be dismissed here rather than merely left "seen": staying in the
    // provider means a later remount re-runs the fold above and could resurrect the stale pre-edit
    // job result over the freshly tweaked plan.
    if (generation.job && (generation.job.status === "succeeded" || generation.job.status === "failed")) {
      generation.dismiss();
    }
  }

  function swapVersion() {
    if (!otherVersion) return;
    const visible = result;
    setResult(otherVersion);
    setOtherVersion(visible);
    setDisplayIndex(0);
    setTweakOpen(false);
    setChatOpen(false);
    setChatThreadSpecId(null);
  }

  function startOver() {
    generation.dismiss();
    setFocusedPlan(null);
    setState("browsing");
    setOtherVersion(null);
    setDisplayIndex(0);
    setLooseners(null);
    setError(null);
    setTweakOpen(false);
    setChatOpen(false);
    setChatThreadSpecId(null);
    onStartOver();
  }

  if (state === "locked" && lockedPlanId) {
    return (
      <div className="stack">
        <div className="card">
          <div className="eyebrow">Locked</div>
          <h1>It's on.</h1>
          <p>Your plan is saved to History. React afterward and PlanBuddy will learn what made it work.</p>
          <div className="row-gap">
            <Link to="/history" className="btn btn-secondary">View in History</Link>
            <button className="btn btn-ghost" onClick={startOver}>{startOverLabel ?? "Plan something else"}</button>
          </div>
        </div>
        {current && <TicketCard view={current} eventStartDate={result.spec.startDate} eventEndDate={result.spec.endDate} />}
      </div>
    );
  }

  // A regenerate (queued, running, or failed-with-retry) takes over the browser; local state is
  // retained underneath so the comparison and queue survive the wait.
  if (generation.job && generation.job.status !== "succeeded" && generation.job.kind === "regenerate") {
    return (
      <div className="stack">
        <GenerationProgress job={generation.job} />
        {generation.job.status === "failed" && (
          <button className="btn btn-ghost btn-block" onClick={() => generation.dismiss()}>Back to my plan</button>
        )}
      </div>
    );
  }

  const companions = participants.filter((participant) => result.spec.participantIds.includes(participant.id));

  return (
    <div className="stack">
      {header}
      {error && <div className="error-banner">{error}</div>}
      {looseners && <div className="hint-banner"><strong>No more fresh batches.</strong> Try: {looseners.join(" · ")}</div>}

      {state === "deadEnd" || !current ? (
        <div className="card">
          <div className="eyebrow">Dead end</div>
          <h2>Nothing cleared your constraints this time.</h2>
          <p>{result.deadEndReasons?.length ? `Every candidate was rejected: ${result.deadEndReasons.slice(0, 3).join("; ")}.` : "Try loosening the radius, dates, or a soft preference."}</p>
          <button className="btn btn-primary" onClick={startOver}>{startOverLabel ?? "Adjust and try again"}</button>
        </div>
      ) : (
        <>
          {otherVersion && (
            <div className="version-banner">
              <div><strong>{result.spec.version > otherVersion.spec.version ? "Revised plan ready" : "Original plan restored"}</strong><span>Both versions are safe—compare without losing either.</span></div>
              <button className="btn btn-ghost btn-sm" onClick={swapVersion}>
                {result.spec.version > otherVersion.spec.version ? "Back to original" : "View revision"}
              </button>
            </div>
          )}
          {generation.job?.kind === "edit" && generation.job.status !== "succeeded" && (
            <div className="plan-edit-in-flight" role="status">
              <Sparkles size={16} />
              <span><strong>Buddy is shaping your revision</strong>{generation.job.stageDetail || generation.job.stageLabel || "Your current plan stays visible while it works."}</span>
              <em>{Math.round(generation.job.progressPct)}%</em>
            </div>
          )}
          <div className="plan-companions" aria-label="People included in this plan">
            <div className="plan-companions__avatars">
              {companions.slice(0, 5).map((participant) => (
                <span className={`plan-companions__avatar plan-companions__avatar--${participant.kind}`} title={participant.name} key={participant.id}>{participant.name.slice(0, 1).toUpperCase()}</span>
              ))}
            </div>
            <span>{companions.length > 1 ? "Made for your circle" : "Made for you"}</span>
          </div>
          <TicketCard view={current} eventStartDate={result.spec.startDate} eventEndDate={result.spec.endDate} />
          <ReactionBar key={current.candidate.id} specId={result.spec.id} candidateId={current.candidate.id} onDislike={() => setNotThisOpen(true)} />
          <div className="plan-action-bar">
            <button className="btn btn-primary" onClick={lockIt}><Lock size={16} /> Lock it</button>
            <button className="btn btn-secondary" onClick={showAnother}><RefreshCw size={16} /> Show another</button>
            <ShareButton candidateId={current.candidate.id} />
            <button className={`btn btn-ghost ${tweakOpen ? "active" : ""}`} onClick={() => setTweakOpen((open) => !open)}>
              <SlidersHorizontal size={16} /> Tweak
            </button>
            <button className="btn btn-ghost" onClick={startOver}><RotateCcw size={16} /> {actionLabel}</button>
          </div>
          <button className={`btn btn-buddy btn-block ${chatOpen ? "active" : ""}`} onClick={() => setChatOpen((open) => !open)}>
            <Bot size={17} /> {chatOpen ? "Close Buddy editor" : "Edit this plan with Buddy"}
          </button>

          {chatOpen && chatThreadSpecId && (
            <PlanEditChat
              threadSpecId={chatThreadSpecId}
              candidate={current.candidate}
              onRevision={applyRevision}
              onLocked={(planId) => { setLockedPlanId(planId); setState("locked"); }}
            />
          )}

          {tweakOpen && (
            <section className="card tweak-panel">
              <button className="icon-btn tweak-panel__close" onClick={() => setTweakOpen(false)} aria-label="Close tweak panel"><X size={18} /></button>
              <div className="eyebrow">Risk-free revision</div>
              <h3>What should change?</h3>
              <p>Your current plan stays visible and saved while PlanBuddy tries the revision.</p>
              <div className="chip-row tweak-presets">
                {["Less walking", "Lower cost", "Earlier finish", "More outdoors"].map((preset) => (
                  <button type="button" className="chip" key={preset} onClick={() => setTweakRequest(preset)}>{preset}</button>
                ))}
              </div>
              <textarea rows={3} value={tweakRequest} onChange={(event) => setTweakRequest(event.target.value)} placeholder="e.g. keep the meal, but make the walks shorter and quieter" />
              {tweakError && <div className="error-banner" role="alert">{tweakError}</div>}
              <div className="row-gap">
                <button className="btn btn-primary" onClick={submitTweak} disabled={tweakSubmitting || !tweakRequest.trim()}>
                  {tweakSubmitting ? "Trying the revision…" : "Build revision"}
                </button>
                <button className="btn btn-ghost" onClick={() => setTweakOpen(false)}>Keep current plan</button>
              </div>
            </section>
          )}

          {notThisOpen && (
            <div className="card">
              <label htmlFor="not-this-reason" style={{ fontWeight: 600, fontSize: "0.85rem" }}>What missed? This becomes a soft preference, never a hard constraint.</label>
              <textarea id="not-this-reason" rows={2} value={notThisReason} onChange={(event) => setNotThisReason(event.target.value)} style={{ width: "100%", marginTop: 8 }} placeholder="Too crowded, too much walking, not the food mood…" />
              <div className="row-gap" style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={submitNotThis}>Save and show another</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setNotThisOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

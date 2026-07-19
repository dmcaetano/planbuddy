import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Friend, Participant, PlanView, PipelineResponse } from "../api/types";
import { SCALE_LABELS, SCALE_RADIUS_KM, type Scale } from "@shared/scale";
import TicketCard from "../components/TicketCard";
import ReactionBar from "../components/ReactionBar";
import ShareButton from "../components/ShareButton";
import PlanEditChat from "../components/PlanEditChat";
import { Bot, Lock, PawPrint, RefreshCw, SlidersHorizontal, User, UserPlus, X } from "lucide-react";

function nextSaturday(): string {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type ViewState = "spec" | "generating" | "browsing" | "locked" | "deadEnd" | "error";

export default function PlanPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [scale, setScale] = useState<Scale>("weekend");
  const [startDate, setStartDate] = useState(nextSaturday());
  const [endDate, setEndDate] = useState(nextSaturday());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moodContext, setMoodContext] = useState("");

  const [state, setState] = useState<ViewState>("spec");
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [otherVersion, setOtherVersion] = useState<PipelineResponse | null>(null);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [notThisOpen, setNotThisOpen] = useState(false);
  const [notThisReason, setNotThisReason] = useState("");
  const [lockedPlanId, setLockedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looseners, setLooseners] = useState<string[] | null>(null);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakRequest, setTweakRequest] = useState("");
  const [tweakSubmitting, setTweakSubmitting] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatThreadSpecId, setChatThreadSpecId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ participants: Participant[] }>("/participants"),
      api.get<{ friends: Friend[] }>("/friends"),
    ]).then(([participantData, friendData]) => {
      const friendParticipants = friendData.friends.map((friend) => friend.participant);
      setParticipants([...participantData.participants, ...friendParticipants]);
      setSelectedIds(participantData.participants.map((participant) => participant.id));
    }).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your group."));
  }, []);

  useEffect(() => {
    setEndDate((previous) => (previous < startDate ? startDate : previous));
  }, [startDate]);

  const displayQueue: PlanView[] = useMemo(() => {
    if (!result?.winner) return [];
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
      setChatThreadSpecId(data.spec.id);
      setOtherVersion(null);
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
      setDisplayIndex((index) => index + 1);
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
      setOtherVersion(null);
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

  async function submitTweak() {
    if (!result || !current) return;
    setTweakSubmitting(true);
    setTweakError(null);
    try {
      const data = await api.post<{ revision: PipelineResponse | null; assistantMessage: { content: string } }>(`/plan-specs/${chatThreadSpecId ?? result.spec.id}/chat-action`, {
        candidateId: current.candidate.id,
        message: tweakRequest.trim(),
      });
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
  }

  function swapVersion() {
    if (!otherVersion || !result) return;
    const visible = result;
    setResult(otherVersion);
    setOtherVersion(visible);
    setDisplayIndex(0);
    setTweakOpen(false);
    setChatOpen(false);
    setChatThreadSpecId(null);
  }

  function startOver() {
    setState("spec");
    setResult(null);
    setOtherVersion(null);
    setDisplayIndex(0);
    setLooseners(null);
    setError(null);
    setTweakOpen(false);
  }

  function toggleParticipant(id: string) {
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((participantId) => participantId !== id) : [...previous, id]);
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
            <button className="btn btn-ghost" onClick={startOver}>Plan something else</button>
          </div>
        </div>
        {current && <TicketCard view={current} eventStartDate={result?.spec.startDate} eventEndDate={result?.spec.endDate} />}
      </div>
    );
  }

  if (state === "generating") {
    return (
      <div className="stack">
        <div className="card">
          <div className="eyebrow">Building your route</div>
          <h2>Finding the plan worth leaving home for…</h2>
          <p className="muted">Checking memory, forecast, real places, route shape, and recent feedback.</p>
        </div>
        <div className="skeleton" style={{ height: 220, borderRadius: 14 }} />
      </div>
    );
  }

  if (state === "browsing" || state === "deadEnd") {
    return (
      <div className="stack">
        {error && <div className="error-banner">{error}</div>}
        {looseners && <div className="hint-banner"><strong>No more fresh batches.</strong> Try: {looseners.join(" · ")}</div>}

        {state === "deadEnd" || !current ? (
          <div className="card">
            <div className="eyebrow">Dead end</div>
            <h2>Nothing cleared your constraints this time.</h2>
            <p>{result?.deadEndReasons?.length ? `Every candidate was rejected: ${result.deadEndReasons.slice(0, 3).join("; ")}.` : "Try loosening the radius, dates, or a soft preference."}</p>
            <button className="btn btn-primary" onClick={startOver}>Adjust and try again</button>
          </div>
        ) : (
          <>
            {otherVersion && (
              <div className="version-banner">
                <div><strong>{result!.spec.version > otherVersion.spec.version ? "Revised plan ready" : "Original plan restored"}</strong><span>Both versions are safe—compare without losing either.</span></div>
                <button className="btn btn-ghost btn-sm" onClick={swapVersion}>
                  {result!.spec.version > otherVersion.spec.version ? "Back to original" : "View revision"}
                </button>
              </div>
            )}
            <TicketCard view={current} eventStartDate={result?.spec.startDate} eventEndDate={result?.spec.endDate} />
            <ReactionBar key={current.candidate.id} specId={result!.spec.id} candidateId={current.candidate.id} onDislike={() => setNotThisOpen(true)} />
            <div className="plan-action-bar">
              <button className="btn btn-primary" onClick={lockIt}><Lock size={16} /> Lock it</button>
              <button className="btn btn-secondary" onClick={showAnother}><RefreshCw size={16} /> Show another</button>
              <ShareButton candidateId={current.candidate.id} />
              <button className={`btn btn-ghost ${tweakOpen ? "active" : ""}`} onClick={() => setTweakOpen((open) => !open)}>
                <SlidersHorizontal size={16} /> Tweak
              </button>
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

  return (
    <div className="stack">
      <div>
        <div className="row-gap" style={{ alignItems: "center", marginBottom: 4 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Plan</div>
          <span className="version-pill">v0.1.4 · social</span>
        </div>
        <h1>One click. One genuinely good plan.</h1>
        <p>PlanBuddy combines what it remembers with live context, then commits to the best fit.</p>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <div className="field">
          <label>Scale</label>
          <div className="chip-row">
            {(Object.keys(SCALE_LABELS) as Scale[]).map((value) => (
              <button key={value} type="button" className={`chip ${scale === value ? "selected" : ""}`} onClick={() => setScale(value)}>{SCALE_LABELS[value]}</button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 4 }}>Default radius: {SCALE_RADIUS_KM[scale]} km</p>
        </div>
        <div className="row-gap">
          <div className="field" style={{ flex: 1 }}><label htmlFor="start">Start</label><input id="start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="end">End</label><input id="end" type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
        </div>
        <div className="field">
          <div className="field-label-row"><label>Who's in</label><Link to="/friends"><UserPlus size={14} /> Friends & invites</Link></div>
          <div className="chip-row">
            {participants.map((participant) => (
              <button key={participant.id} type="button" className={`chip ${selectedIds.includes(participant.id) ? "selected" : ""}`} onClick={() => toggleParticipant(participant.id)}>
                {participant.kind === "pet" ? <PawPrint size={14} /> : <User size={14} />} {participant.name}
                {participant.isFriendAccount && <span className="friend-dot" title="Connected friend" />}
              </button>
            ))}
          </div>
          {participants.some((participant) => participant.isFriendAccount) && <p className="privacy-note">Only selected friends influence this plan. Their private memory stays hidden.</p>}
        </div>
        <div className="field">
          <label htmlFor="mood">Anything different this time? <span className="muted">Optional</span></label>
          <textarea id="mood" rows={2} placeholder="e.g. grilled fish, a soft walk, and our Pom is coming" value={moodContext} onChange={(event) => setMoodContext(event.target.value)} />
        </div>
        <button className="btn btn-primary btn-block" onClick={planIt} disabled={selectedIds.length === 0}>Plan my {SCALE_LABELS[scale].toLowerCase()}</button>
      </div>
    </div>
  );
}

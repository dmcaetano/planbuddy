import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { listFriendLabels, listFriendsWithLabels } from "../api/friends";
import type { Friend, FriendLabelSummary, Participant, PlanView, PipelineResponse } from "../api/types";
import { SCALE_LABELS, SCALE_RADIUS_KM, type Scale } from "@shared/scale";
import TicketCard from "../components/TicketCard";
import ReactionBar from "../components/ReactionBar";
import ShareButton from "../components/ShareButton";
import PlanEditChat from "../components/PlanEditChat";
import GenerationProgress from "../components/GenerationProgress";
import { useGeneration } from "../state/GenerationContext";
import { useAuth } from "../state/AuthContext";
import { usePlanFocus } from "../state/PlanFocusContext";
import { Bot, ChevronDown, ChevronUp, Lock, PawPrint, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, User, UserPlus, Users, X } from "lucide-react";

function lastGroupStorageKey(userId: string): string {
  return `planbuddy.lastGroup.${userId}`;
}

function nextSaturday(): string {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type ViewState = "spec" | "browsing" | "locked" | "deadEnd" | "error";

export default function PlanPage() {
  const generation = useGeneration();
  const auth = useAuth();
  const { setFocusedPlan } = usePlanFocus();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendLabels, setFriendLabels] = useState<FriendLabelSummary[]>([]);
  const [friendLabelsLoaded, setFriendLabelsLoaded] = useState(false);
  const [lastGroupIds, setLastGroupIds] = useState<string[] | null>(null);
  const [scale, setScale] = useState<Scale>("weekend");
  const [startDate, setStartDate] = useState(nextSaturday());
  const [endDate, setEndDate] = useState(nextSaturday());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moodContext, setMoodContext] = useState("");
  const [radiusKm, setRadiusKm] = useState(SCALE_RADIUS_KM.weekend);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mealTiming, setMealTiming] = useState<"flexible" | "lunch" | "dinner">("flexible");
  const [walkingLevel, setWalkingLevel] = useState<"light" | "balanced" | "long">("balanced");
  const [budget, setBudget] = useState<"flexible" | "25" | "40" | "60">("flexible");
  const [setting, setSetting] = useState<"mixed" | "outdoors" | "indoors">("mixed");
  const [transport, setTransport] = useState<"flexible" | "public" | "car">("flexible");

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
      listFriendsWithLabels(),
    ]).then(([participantData, friendData]) => {
      const friendParticipants = friendData.friends.map((friend) => friend.participant);
      setParticipants([...participantData.participants, ...friendParticipants]);
      setFriends(friendData.friends);
      setSelectedIds(participantData.participants.map((participant) => participant.id));
    }).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your group."));
  }, []);

  useEffect(() => {
    setEndDate((previous) => (previous < startDate ? startDate : previous));
  }, [startDate]);

  // Lazily loads friend-group labels the first time the spec form is shown, not on every mount.
  useEffect(() => {
    if (state !== "spec" || friendLabelsLoaded) return;
    setFriendLabelsLoaded(true);
    listFriendLabels()
      .then((data) => setFriendLabels(data.labels))
      .catch(() => {
        // Chips simply don't render — the manual checklist still works.
      });
  }, [state, friendLabelsLoaded]);

  // Reads the saved "last group" (a set of friend participant ids) whenever the spec form is shown.
  useEffect(() => {
    if (state !== "spec") return;
    const userId = auth.user?.id;
    if (!userId) {
      setLastGroupIds(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(lastGroupStorageKey(userId));
      if (!raw) {
        setLastGroupIds(null);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      setLastGroupIds(Array.isArray(parsed) && parsed.every((id) => typeof id === "string") && parsed.length > 0 ? parsed : null);
    } catch {
      setLastGroupIds(null);
    }
  }, [state, auth.user?.id]);

  const friendUserIdToParticipantId = useMemo(() => {
    const map = new Map<string, string>();
    friends.forEach((friend) => map.set(friend.userId, friend.participant.id));
    return map;
  }, [friends]);

  const friendParticipantIdSet = useMemo(() => new Set(friends.map((friend) => friend.participant.id)), [friends]);

  const currentFriendSelectedIds = useMemo(
    () => selectedIds.filter((id) => friendParticipantIdSet.has(id)),
    [selectedIds, friendParticipantIdSet]
  );

  const groupLabels = useMemo(() => friendLabels.filter((label) => label.memberCount > 0), [friendLabels]);

  function labelParticipantIds(label: FriendLabelSummary): string[] {
    return label.friendUserIds
      .map((userId) => friendUserIdToParticipantId.get(userId))
      .filter((id): id is string => Boolean(id));
  }

  function isLabelSelected(label: FriendLabelSummary): boolean {
    const ids = labelParticipantIds(label);
    return ids.length > 0 && ids.every((id) => selectedIds.includes(id));
  }

  function toggleLabel(label: FriendLabelSummary) {
    const ids = labelParticipantIds(label);
    if (ids.length === 0) return;
    setSelectedIds((previous) => {
      if (ids.every((id) => previous.includes(id))) {
        return previous.filter((id) => !ids.includes(id));
      }
      const merged = new Set(previous);
      ids.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  }

  // Valid only when every saved id still resolves to a current friend's participant.
  const validLastGroupIds = useMemo(() => {
    if (!lastGroupIds || lastGroupIds.length === 0) return null;
    return lastGroupIds.every((id) => friendParticipantIdSet.has(id)) ? lastGroupIds : null;
  }, [lastGroupIds, friendParticipantIdSet]);

  const showLastGroupChip = useMemo(() => {
    if (!validLastGroupIds) return false;
    const saved = new Set(validLastGroupIds);
    const current = new Set(currentFriendSelectedIds);
    if (saved.size !== current.size) return true;
    for (const id of saved) if (!current.has(id)) return true;
    return false;
  }, [validLastGroupIds, currentFriendSelectedIds]);

  function applyLastGroup() {
    if (!validLastGroupIds) return;
    setSelectedIds((previous) => {
      const nonFriendIds = previous.filter((id) => !friendParticipantIdSet.has(id));
      return [...nonFriendIds, ...validLastGroupIds];
    });
  }

  function saveLastGroup(friendParticipantIds: string[]) {
    const userId = auth.user?.id;
    if (!userId || friendParticipantIds.length === 0) return;
    try {
      window.localStorage.setItem(lastGroupStorageKey(userId), JSON.stringify(friendParticipantIds));
    } catch {
      // Storage can fail (quota, private mode) — not worth surfacing to the user.
    }
  }

  const displayQueue: PlanView[] = useMemo(() => {
    if (!result?.winner) return [];
    return [result.winner, ...result.alternates];
  }, [result]);
  const current = displayQueue[displayIndex] ?? null;

  useEffect(() => {
    if (state === "browsing" && result && current) {
      setFocusedPlan({ specId: chatThreadSpecId ?? result.spec.id, candidate: current.candidate });
    } else {
      setFocusedPlan(null);
    }
  }, [chatThreadSpecId, current, result, setFocusedPlan, state]);

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

  // Tracks which terminal job we've already folded into local view state, so re-renders (or a
  // job that was already terminal when this page mounted) don't reapply it more than once.
  const appliedJobIdRef = useRef<string | null>(null);

  // Runs synchronously before paint so a just-finished job never flashes the stale spec/browsing
  // view for a frame before the result (or failure) is folded in. Buddy edits use the same job
  // lifecycle as a fresh plan, but retain the exact prior plan as a reversible comparison.
  useLayoutEffect(() => {
    const job = generation.job;
    if (!job || (job.status !== "succeeded" && job.status !== "failed")) return;
    if (appliedJobIdRef.current === job.jobId) return;
    appliedJobIdRef.current = job.jobId;

    // Failures stay visible via GenerationProgress (with Retry) until the user retries or starts
    // a new plan, so leave the job in place here.
    if (job.status === "failed") return;

    if (job.result) {
      const data = job.result;
      if (data.looseners) {
        setLooseners(data.looseners);
        setState("browsing");
      } else if (job.kind === "edit" && result) {
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

  async function planIt() {
    setError(null);
    setLooseners(null);
    if (currentFriendSelectedIds.length > 0) saveLastGroup(currentFriendSelectedIds);
    try {
      await generation.startSpec({
        scale,
        startDate,
        endDate,
        radiusKm,
        participantIds: selectedIds,
        moodContext: [
          moodContext.trim(),
          `Meal: ${mealTiming}`,
          `Walking: ${walkingLevel === "light" ? "20-40 minutes" : walkingLevel === "long" ? "75-120 minutes" : "45-75 minutes"}`,
          `Budget: ${budget === "flexible" ? "flexible" : `up to €${budget} per person`}`,
          `Setting: ${setting}`,
          `Transport: ${transport}`,
        ].filter(Boolean).join(". ").slice(0, 280),
      });
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
    try {
      await generation.startRegenerate(result.spec.id);
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

  // The Tweak panel sends a free-text request through the same synchronous chat-action endpoint
  // PlanEditChat uses (an AI-interpreted action dispatch, not the async plan-generation pipeline),
  // so this stays a plain request/response call rather than a tracked job.
  async function submitTweak() {
    if (!result || !current) return;
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
    // provider means a later remount of this page (e.g. navigating away and back) re-runs the fold
    // effect above, and — because local state has reset — that effect can no longer see this tweak
    // happened, so it would resurrect the stale pre-edit job result over the freshly tweaked plan.
    if (generation.job && (generation.job.status === "succeeded" || generation.job.status === "failed")) {
      generation.dismiss();
    }
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
    generation.dismiss();
    setState("spec");
    setResult(null);
    setOtherVersion(null);
    setDisplayIndex(0);
    setLooseners(null);
    setError(null);
    setTweakOpen(false);
    setChatOpen(false);
    setChatThreadSpecId(null);
    setMoodContext("");
    setScale("weekend");
    setRadiusKm(SCALE_RADIUS_KM.weekend);
    setStartDate(nextSaturday());
    setEndDate(nextSaturday());
    setMealTiming("flexible");
    setWalkingLevel("balanced");
    setBudget("flexible");
    setSetting("mixed");
    setTransport("flexible");
  }

  function chooseScale(value: Scale) {
    setScale(value);
    setRadiusKm(SCALE_RADIUS_KM[value]);
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

  // A fresh generate/regenerate job (queued, running, or failed-with-retry) takes over the whole
  // page regardless of local `state` — it may have been reattached after a reload or tab switch,
  // long before this render's local state caught up.
  if (generation.job && generation.job.status !== "succeeded" && generation.job.kind !== "edit") {
    return <GenerationProgress job={generation.job} />;
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
            {generation.job?.kind === "edit" && generation.job.status !== "succeeded" && (
              <div className="plan-edit-in-flight" role="status">
                <Sparkles size={16} />
                <span><strong>Buddy is shaping your revision</strong>{generation.job.stageDetail || generation.job.stageLabel || "Your current plan stays visible while it works."}</span>
                <em>{Math.round(generation.job.progressPct)}%</em>
              </div>
            )}
            <div className="plan-companions" aria-label="People included in this plan">
              <div className="plan-companions__avatars">
                {participants.filter((participant) => result!.spec.participantIds.includes(participant.id)).slice(0, 5).map((participant) => (
                  <span className={`plan-companions__avatar plan-companions__avatar--${participant.kind}`} title={participant.name} key={participant.id}>{participant.name.slice(0, 1).toUpperCase()}</span>
                ))}
              </div>
              <span>{participants.filter((participant) => result!.spec.participantIds.includes(participant.id)).length > 1 ? "Made for your circle" : "Made for you"}</span>
            </div>
            <TicketCard view={current} eventStartDate={result?.spec.startDate} eventEndDate={result?.spec.endDate} />
            <ReactionBar key={current.candidate.id} specId={result!.spec.id} candidateId={current.candidate.id} onDislike={() => setNotThisOpen(true)} />
            <div className="plan-action-bar">
              <button className="btn btn-primary" onClick={lockIt}><Lock size={16} /> Lock it</button>
              <button className="btn btn-secondary" onClick={showAnother}><RefreshCw size={16} /> Show another</button>
              <ShareButton candidateId={current.candidate.id} />
              <button className={`btn btn-ghost ${tweakOpen ? "active" : ""}`} onClick={() => setTweakOpen((open) => !open)}>
                <SlidersHorizontal size={16} /> Tweak
              </button>
              <button className="btn btn-ghost" onClick={startOver}><RotateCcw size={16} /> Start over</button>
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
          <span className="version-pill">v1.1.4 · wasp</span>
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
              <button key={value} type="button" className={`chip ${scale === value ? "selected" : ""}`} onClick={() => chooseScale(value)}>{SCALE_LABELS[value]}</button>
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
          {(groupLabels.length > 0 || showLastGroupChip) && (
            <div className="chip-row pb-group-chip-row">
              {showLastGroupChip && validLastGroupIds && (
                <button type="button" className="chip pb-group-chip" aria-pressed={false} onClick={applyLastGroup}>
                  <Users size={14} /> Last group ({validLastGroupIds.length})
                </button>
              )}
              {groupLabels.map((label) => {
                const selected = isLabelSelected(label);
                return (
                  <button
                    key={label.id}
                    type="button"
                    className={`chip pb-group-chip ${selected ? "selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => toggleLabel(label)}
                  >
                    <Users size={14} /> {label.name} ({label.memberCount})
                  </button>
                );
              })}
            </div>
          )}
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
        <button type="button" className="btn btn-ghost btn-block" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
          <SlidersHorizontal size={16} /> Plan controls {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {advancedOpen && (
          <section className="advanced-plan-controls" aria-label="Advanced plan controls">
            <div className="field advanced-plan-controls__wide">
              <div className="field-label-row"><label htmlFor="radius">Search radius</label><strong>{radiusKm} km</strong></div>
              <input id="radius" type="range" min={2} max={SCALE_RADIUS_KM[scale]} step={1} value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} />
            </div>
            <div className="field"><label htmlFor="meal-timing">Meal</label><select id="meal-timing" className="select" value={mealTiming} onChange={(event) => setMealTiming(event.target.value as typeof mealTiming)}><option value="flexible">Flexible</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></div>
            <div className="field"><label htmlFor="walking-level">Walking</label><select id="walking-level" className="select" value={walkingLevel} onChange={(event) => setWalkingLevel(event.target.value as typeof walkingLevel)}><option value="light">Light · 20–40 min</option><option value="balanced">Balanced · 45–75 min</option><option value="long">Long · 75–120 min</option></select></div>
            <div className="field"><label htmlFor="budget">Budget</label><select id="budget" className="select" value={budget} onChange={(event) => setBudget(event.target.value as typeof budget)}><option value="flexible">Flexible</option><option value="25">Up to €25 / person</option><option value="40">Up to €40 / person</option><option value="60">Up to €60 / person</option></select></div>
            <div className="field"><label htmlFor="setting">Setting</label><select id="setting" className="select" value={setting} onChange={(event) => setSetting(event.target.value as typeof setting)}><option value="mixed">Mixed</option><option value="outdoors">Mostly outdoors</option><option value="indoors">Mostly indoors</option></select></div>
            <div className="field"><label htmlFor="transport">Getting there</label><select id="transport" className="select" value={transport} onChange={(event) => setTransport(event.target.value as typeof transport)}><option value="flexible">Best option</option><option value="public">Public transport</option><option value="car">Car is fine</option></select></div>
          </section>
        )}
        <button className="btn btn-primary btn-block" onClick={planIt} disabled={selectedIds.length === 0}>Plan my {SCALE_LABELS[scale].toLowerCase()}</button>
      </div>
    </div>
  );
}

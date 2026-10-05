import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { listFriendLabels, listFriendsWithLabels } from "../api/friends";
import type { Friend, FriendLabelSummary, Participant, PipelineResponse } from "../api/types";
import { SCALE_LABELS, SCALE_RADIUS_KM, type Scale } from "@shared/scale";
import PlanBrowser from "../components/PlanBrowser";
import GenerationProgress from "../components/GenerationProgress";
import { useGeneration } from "../state/GenerationContext";
import { useAuth } from "../state/AuthContext";
import { VERSION_PILL } from "../version";
import type { CustomizeState } from "../lib/momentClient";
import { ChevronDown, ChevronUp, PawPrint, SlidersHorizontal, User, UserPlus, Users } from "lucide-react";

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

export default function PlanPage() {
  const generation = useGeneration();
  const auth = useAuth();
  // Home hands over the household group and the kind of moment so Customize opens prefilled.
  const handoff = (useLocation().state ?? null) as CustomizeState | null;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendLabels, setFriendLabels] = useState<FriendLabelSummary[]>([]);
  const [friendLabelsLoaded, setFriendLabelsLoaded] = useState(false);
  const [lastGroupIds, setLastGroupIds] = useState<string[] | null>(null);
  const [scale, setScale] = useState<Scale>(handoff?.scale ?? (handoff?.kind === "weekend" ? "weekend" : handoff?.kind ? "day_off" : "weekend"));
  const [startDate, setStartDate] = useState(handoff?.planDate ?? nextSaturday());
  const [endDate, setEndDate] = useState(handoff?.planDate ?? nextSaturday());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moodContext, setMoodContext] = useState("");
  const [radiusKm, setRadiusKm] = useState(SCALE_RADIUS_KM[handoff?.scale ?? (handoff?.kind === "weekend" ? "weekend" : handoff?.kind ? "day_off" : "weekend")]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mealTiming, setMealTiming] = useState<"flexible" | "lunch" | "dinner">(handoff?.kind === "tonight" ? "dinner" : handoff?.kind === "day" ? "lunch" : "flexible");
  const [walkingLevel, setWalkingLevel] = useState<"light" | "balanced" | "long">("balanced");
  const [budget, setBudget] = useState<"flexible" | "25" | "40" | "60">("flexible");
  const [setting, setSetting] = useState<"mixed" | "outdoors" | "indoors">("mixed");
  const [transport, setTransport] = useState<"flexible" | "public" | "car">("flexible");

  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ participants: Participant[] }>("/participants"),
      listFriendsWithLabels(),
    ]).then(([participantData, friendData]) => {
      const friendParticipants = friendData.friends.map((friend) => friend.participant);
      setParticipants([...participantData.participants, ...friendParticipants]);
      setFriends(friendData.friends);
      const allLocalIds = participantData.participants.map((participant) => participant.id);
      const handedOver = (handoff?.group ?? []).filter((id) => allLocalIds.includes(id));
      setSelectedIds(handedOver.length > 0 ? handedOver : allLocalIds);
    }).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your group."));
    // Runs once on mount: the handoff from Home is only a starting selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEndDate((previous) => (previous < startDate ? startDate : previous));
  }, [startDate]);

  // Lazily loads friend-group labels the first time the spec form is shown, not on every mount.
  useEffect(() => {
    if (friendLabelsLoaded) return;
    setFriendLabelsLoaded(true);
    listFriendLabels()
      .then((data) => setFriendLabels(data.labels))
      .catch(() => {
        // Chips simply don't render — the manual checklist still works.
      });
  }, [friendLabelsLoaded]);

  // Reads the saved "last group" (a set of friend participant ids) whenever the spec form is shown.
  useEffect(() => {
    if (result) return;
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
  }, [result, auth.user?.id]);

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

  // Tracks which terminal job we've already folded into local view state, so re-renders (or a
  // job that was already terminal when this page mounted) don't reapply it more than once.
  const appliedJobIdRef = useRef<string | null>(null);

  // Folds a finished plan job into the page while no plan is being browsed yet (a fresh generate, or
  // a job that finished while the user was elsewhere). Once a plan is on screen, PlanBrowser folds
  // regenerate/edit results itself. Moment jobs belong to Home and are never touched here. Runs
  // synchronously before paint so a just-finished job never flashes the stale form.
  useLayoutEffect(() => {
    const job = generation.job;
    if (!job || (job.status !== "succeeded" && job.status !== "failed")) return;
    if (job.kind === "moment") return;
    if (appliedJobIdRef.current === job.jobId) return;
    appliedJobIdRef.current = job.jobId;
    if (result) return;

    // Failures stay visible via GenerationProgress (with Retry) until the user retries or starts
    // a new plan, so leave the job in place here.
    if (job.status === "failed") return;

    if (job.result) {
      if (job.result.looseners) {
        setError(`No fresh batches. Try: ${job.result.looseners.join(" · ")}`);
      } else {
        setResult(job.result);
      }
    }
    generation.markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.job]);

  async function planIt() {
    setError(null);
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
    }
  }

  function startOver() {
    setResult(null);
    setError(null);
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

  if (result) {
    return (
      <div className="stack">
        {error && <div className="error-banner">{error}</div>}
        <PlanBrowser key={result.spec.id} initial={result} participants={participants} onStartOver={startOver} />
      </div>
    );
  }

  // A fresh generate (queued, running, or failed-with-retry) takes over the whole page regardless of
  // local state — it may have been reattached after a reload or tab switch, long before this
  // render's local state caught up. Moment jobs are Home's; edits keep the plan visible.
  if (generation.job && generation.job.status !== "succeeded" && generation.job.kind !== "edit" && generation.job.kind !== "moment") {
    return <GenerationProgress job={generation.job} />;
  }

  return (
    <div className="stack">
      <div>
        <div className="row-gap" style={{ alignItems: "center", marginBottom: 4 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Plan</div>
          <span className="version-pill">{VERSION_PILL}</span>
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

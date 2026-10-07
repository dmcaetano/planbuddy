import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Compass, Sparkles, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Participant, PipelineResponse } from "../api/types";
import type { MomentInfo, MomentKind, MomentResponse, TripIdea, TripNudge } from "@shared/momentTypes";
import { radiusForScale, type Scale } from "@shared/scale";
import PlanBrowser from "../components/PlanBrowser";
import GenerationProgress from "../components/GenerationProgress";
import TripNudgeCard from "../components/TripNudgeCard";
import { Skeleton } from "../components/Skeleton";
import { useGeneration } from "../state/GenerationContext";
import { useAuth } from "../state/AuthContext";
import { VERSION_PILL } from "../version";
import { currentMoment, formatLocalDate, formatLocalDateTime, momentLoadingText, scopeSwitchDates, type CustomizeState } from "../lib/momentClient";
import "../styles/home.css";

const FOCUS_REFRESH_MS = 5 * 60 * 1000;
const MOMENT_CHECK_MS = 20 * 1000;

type Phase = "loading" | "ready" | "empty" | "error";

interface Proposal {
  plan: PipelineResponse;
  lockedPlanId: string | null;
}

const SCOPE_CHIPS: { kind: MomentKind; label: string }[] = [
  { kind: "tonight", label: "Tonight" },
  { kind: "day", label: "A day out" },
  { kind: "weekend", label: "This weekend" },
];

/** Collects the distinct narration lines of one running job, so the person sees the work happen as a trail. */
function useLiveSteps(line: string | null, jobId: string | null): string[] {
  const [steps, setSteps] = useState<{ jobId: string | null; lines: string[] }>({ jobId: null, lines: [] });
  useEffect(() => {
    if (!line) return;
    setSteps((prev) => {
      const lines = prev.jobId === jobId ? prev.lines : [];
      return lines[lines.length - 1] === line ? prev : { jobId, lines: [...lines, line].slice(-5) };
    });
  }, [line, jobId]);
  return steps.jobId === jobId ? steps.lines : [];
}

/** The screen the app opens on: a proposal for right now, one tap from locking. */
export default function HomePage() {
  const generation = useGeneration();
  const auth = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("loading");
  const [moment, setMoment] = useState<MomentInfo | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reasonLine, setReasonLine] = useState<string | null>(null);
  const [nudge, setNudge] = useState<TripNudge | null>(null);
  const [lead, setLead] = useState<"moment" | "nudge">("moment");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  // Loading text before the server has answered, from the same moment table the server uses.
  const [provisional] = useState(() => momentLoadingText(currentMoment()));

  const generationRef = useRef(generation);
  generationRef.current = generation;
  const requestSeqRef = useRef(0);
  const loadedAtRef = useRef(Date.now());
  const keyRef = useRef<string | null>(null);
  const proposalRef = useRef<Proposal | null>(null);
  proposalRef.current = proposal;
  // A job that was already finished when Home mounted is not Home's to fold (the proposal comes from the server).
  const appliedJobIdRef = useRef<string | null>(
    generation.job && (generation.job.status === "succeeded" || generation.job.status === "failed") ? generation.job.jobId : null
  );
  const mountedRef = useRef(true);
  const followUpsRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Asks the server for the proposal for this moment. `mode` "silent" keeps whatever is on screen
   * (a refresh on focus); "full" shows the skeleton; "afterJob" is the follow-up to a moment job and
   * treats a second "generating" answer as a failure instead of looping.
   */
  const loadMoment = useCallback(async (mode: "full" | "silent" | "afterJob" = "full", fresh = false, kind?: MomentKind) => {
    const seq = ++requestSeqRef.current;
    if (mode !== "silent") {
      setPhase("loading");
      setError(null);
    }
    try {
      const data = await api.post<MomentResponse>("/moment", { localDateTime: formatLocalDateTime(new Date()), ...(fresh ? { fresh: true } : {}), ...(kind ? { kind } : {}) });
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      loadedAtRef.current = Date.now();
      keyRef.current = data.moment.key;
      setMoment(data.moment);
      setNudge(data.nudge);
      setLead(data.lead);

      if (data.status === "empty_household") {
        setProposal(null);
        setReasonLine(null);
        setPhase("empty");
        return;
      }
      if (data.status === "generating") {
        // A background refresh never takes the screen over or competes for the single job slot.
        if (mode === "silent") return;
        // A moment job for an earlier moment (e.g. the clock crossed 21:00 while it ran) can still hold
        // the single job slot; its result is not this moment's plan, so follow the next job a bounded
        // number of times before calling it a failure.
        if (mode === "afterJob") followUpsRef.current += 1;
        else followUpsRef.current = 0;
        if (!data.jobId || (mode === "afterJob" && followUpsRef.current > 2)) {
          setError("Your plan didn't come together. Try again, or customize it yourself.");
          setPhase("error");
          return;
        }
        setProposal(null);
        setReasonLine(data.reasonLine);
        setPhase("loading");
        generationRef.current.trackJob(data.jobId, "moment", null);
        return;
      }
      const plan = data.plan as PipelineResponse | null;
      if (!plan) {
        setError("Your plan didn't come together. Try again, or customize it yourself.");
        setPhase("error");
        return;
      }
      const lockedPlanId = data.status === "locked" ? data.lockedPlanId : null;
      const previous = proposalRef.current;
      // A silent refresh of the plan already on screen must not clobber what the person is browsing.
      if (!(mode === "silent" && previous && previous.plan.spec.id === plan.spec.id && previous.lockedPlanId === lockedPlanId)) {
        setProposal({ plan, lockedPlanId });
      }
      setReasonLine(data.reasonLine);
      setPhase("ready");
    } catch (err) {
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      if (mode === "silent" && proposalRef.current) return; // keep the proposal we have
      setError(err instanceof ApiError ? err.message : "Couldn't reach PlanBuddy. Please check your connection.");
      setPhase("error");
    }
  }, []);

  // First load: ask the server for the moment's proposal (a reuse, or the start of a moment job).
  useEffect(() => {
    // A scope-switch generation already running when Home opens owns the screen; it folds into the
    // proposal when it finishes, so asking for the moment now would only compete with it.
    const running = generationRef.current.job;
    const generationInFlight = Boolean(running) && (running!.status === "queued" || running!.status === "running") && running!.kind === "generate";
    const wanted = sessionStorage.getItem("planbuddy:new-plan");
    sessionStorage.removeItem("planbuddy:new-plan");
    if (!generationInFlight) void loadMoment("full", Boolean(wanted), wanted === "tonight" || wanted === "day" || wanted === "weekend" ? wanted : undefined);
    api.get<{ participants: Participant[] }>("/participants")
      .then((data) => {
        if (mountedRef.current) setParticipants(data.participants);
      })
      .catch(() => {
        // The avatars on the plan are decoration; the proposal works without them.
      });
  }, [loadMoment]);

  useEffect(() => {
    const onNewPlan = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: MomentKind | null }>).detail?.scope ?? undefined;
      generationRef.current.dismiss();
      void loadMoment("full", true, scope);
    };
    window.addEventListener("planbuddy:new-plan", onNewPlan);
    return () => window.removeEventListener("planbuddy:new-plan", onNewPlan);
  }, [loadMoment]);

  // The moment changes while the page is open (e.g. Friday 20:59 -> 21:00) or the page comes back
  // after a while: ask again.
  useEffect(() => {
    function jobActive(): boolean {
      const job = generationRef.current.job;
      return Boolean(job) && (job!.status === "queued" || job!.status === "running");
    }
    function check() {
      if (document.hidden || jobActive()) return;
      if (keyRef.current && currentMoment().key !== keyRef.current) void loadMoment("full");
    }
    function onFocus() {
      if (document.hidden || jobActive()) return;
      if (keyRef.current && currentMoment().key !== keyRef.current) void loadMoment("full");
      else if (Date.now() - loadedAtRef.current > FOCUS_REFRESH_MS) void loadMoment("silent");
    }
    const timer = window.setInterval(check, MOMENT_CHECK_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadMoment]);

  // Folds finished jobs: the moment job Home asked for (then asks the server again for the plan and
  // its line) and a scope-switch generation. Runs before paint so the screen never flashes stale.
  useLayoutEffect(() => {
    const job = generation.job;
    if (!job || (job.status !== "succeeded" && job.status !== "failed")) return;
    if (job.kind !== "moment" && job.kind !== "generate") return;
    if (appliedJobIdRef.current === job.jobId) return;
    appliedJobIdRef.current = job.jobId;

    // A moment job reattached after a reload before its local hint was written is adopted as a plain
    // "generate"; its result's spec carries the moment key, so it is still the moment's job.
    const isMomentJob = job.kind === "moment" || Boolean(job.result?.spec?.momentKey);
    if (isMomentJob) {
      if (job.status === "failed") {
        setError(job.errorMessage || "Something went wrong building your plan.");
        setPhase("error");
      } else {
        void loadMoment("afterJob");
      }
      generation.dismiss();
      return;
    }

    // A scope-switch generation (or a Customize one finished while Home was open).
    if (job.status === "failed") return; // stays visible as a retryable takeover below
    if (job.result?.looseners) {
      setActionError(`No fresh batches. Try: ${job.result.looseners.join(" · ")}`);
    } else if (job.result) {
      requestSeqRef.current += 1; // anything still in flight is older than this
      setProposal({ plan: job.result, lockedPlanId: null });
      setReasonLine(null);
      setPhase("ready");
    }
    generation.markSeen();
    generation.dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.job]);

  const group = proposal?.plan.spec.participantIds ?? participants.map((participant) => participant.id);

  function customizeState(extra: Partial<CustomizeState> = {}): CustomizeState {
    return { group, kind: moment?.kind, planDate: moment?.planDate, ...extra };
  }

  function openCustomize(extra: Partial<CustomizeState> = {}) {
    navigate("/plan/custom", { state: customizeState(extra) });
  }

  async function switchScope(kind: MomentKind) {
    setActionError(null);
    const dates = scopeSwitchDates();
    const scale: Scale = kind === "weekend" ? "weekend" : "day_off";
    try {
      await generation.startSpec({
        scale,
        startDate: dates[kind],
        endDate: dates[kind],
        radiusKm: radiusForScale(scale, auth.user),
        participantIds: group,
        moodContext: kind === "tonight" ? "Meal: dinner" : kind === "day" ? "Meal: lunch" : null,
      });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't start that plan. Please try again.");
    }
  }

  async function startTrip(scale: Scale, moodContext: string | null) {
    if (!nudge) return;
    setActionError(null);
    try {
      await generation.startSpec({
        scale,
        startDate: nudge.timeOff.startDate,
        endDate: nudge.timeOff.endDate,
        radiusKm: radiusForScale(scale, auth.user),
        participantIds: group,
        moodContext,
      });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't start that trip plan. Please try again.");
    }
  }

  function tripChip() {
    if (nudge) void startTrip("getaway", null);
    else openCustomize({ scale: "getaway", kind: undefined, planDate: undefined });
  }

  function pickIdea(idea: TripIdea) {
    void startTrip(idea.scope, `Trip idea: ${idea.name}`.slice(0, 280));
  }

  async function nudgeNotNow() {
    if (!nudge) return;
    setNudgeBusy(true);
    setActionError(null);
    try {
      await api.post(`/time-off/${nudge.timeOff.id}/snooze`, { localDate: formatLocalDate(new Date()) });
      setNudge(null);
      if (lead === "nudge") setLead("moment");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't hide that right now.");
    } finally {
      setNudgeBusy(false);
    }
  }

  async function nudgeOtherIdeas() {
    if (!nudge) return;
    setNudgeBusy(true);
    setActionError(null);
    try {
      const data = await api.post<{ ideas: TripIdea[] }>(`/time-off/${nudge.timeOff.id}/ideas`);
      if (data?.ideas?.length) setNudge({ ...nudge, ideas: data.ideas });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't find other ideas right now.");
    } finally {
      setNudgeBusy(false);
    }
  }

  const nudgeCard = nudge ? (
    <TripNudgeCard
      key="nudge"
      nudge={nudge}
      lead={lead === "nudge"}
      busy={nudgeBusy}
      onPickIdea={pickIdea}
      onNotNow={() => void nudgeNotNow()}
      onOtherIdeas={() => void nudgeOtherIdeas()}
      onPlanThisWeekend={() => void switchScope("weekend")}
    />
  ) : null;

  const header = (
    <div className="home-head">
      <div className="row-gap" style={{ alignItems: "center", marginBottom: 4 }}>
        <div className="eyebrow" style={{ marginBottom: 0 }}>{moment ? moment.label : "Plan"}</div>
        <span className="version-pill">{VERSION_PILL}</span>
      </div>
    </div>
  );

  // A scope-switch generation (or a Customize one picked up here) takes over the screen; a moment job
  // shows its moment-specific wording above the same progress.
  const job = generation.job;
  const liveSteps = useLiveSteps(job && job.status !== "succeeded" && job.status !== "failed" ? job.stageDetail ?? job.stageLabel ?? null : null, job?.jobId ?? null);
  if (job && job.status !== "succeeded" && (job.kind === "generate" || job.kind === "moment")) {
    const text = moment && job.kind === "moment" ? momentLoadingText(moment) : job.kind === "moment" ? provisional : "Building your plan…";
    return (
      <div className="stack home">
        {header}
        <p className="home-status" role="status" aria-live="polite">{text}</p>
        {reasonLine && <p className="home-reason"><Sparkles size={15} aria-hidden="true" /> <span>{reasonLine}</span></p>}
        {liveSteps.length > 0 && (
          <ol className="home-live-steps" aria-label="What PlanBuddy is doing">
            {liveSteps.map((step, index) => (
              <li key={step} className={index === liveSteps.length - 1 ? "home-live-steps__item home-live-steps__item--now" : "home-live-steps__item"}>{step}</li>
            ))}
          </ol>
        )}
        <GenerationProgress job={job} />
        {job.status === "failed" && (
          <div className="row-gap">
            <button className="btn btn-secondary" onClick={() => { generation.dismiss(); void loadMoment("full"); }}>Back to my plan</button>
            <button className="btn btn-ghost" onClick={() => { generation.dismiss(); openCustomize(); }}><SlidersHorizontal size={16} /> Customize</button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "loading") {
    const text = moment ? momentLoadingText(moment) : provisional;
    return (
      <div className="stack home">
        {header}
        <section className="home-skeleton" aria-busy="true">
          <p className="home-status" role="status" aria-live="polite">{text}</p>
          {reasonLine && <p className="home-reason"><Sparkles size={15} aria-hidden="true" /> <span>{reasonLine}</span></p>}
          <div className="card skeleton-card" aria-hidden="true">
            <Skeleton className="home-skeleton__image" />
            <Skeleton className="skeleton-line skeleton-line--title" />
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line" style={{ width: "70%" }} />
          </div>
        </section>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="stack home">
        {header}
        <div className="card">
          <div className="eyebrow">Couldn't find a plan</div>
          <h2 role="alert">{error ?? "Something went wrong."}</h2>
          <p className="muted">Nothing was lost. Try again, or set it up yourself.</p>
          <div className="row-gap">
            <button className="btn btn-primary" onClick={() => void loadMoment("full")}>Retry</button>
            <button className="btn btn-secondary" onClick={() => openCustomize()}><SlidersHorizontal size={16} /> Customize</button>
          </div>
        </div>
        {nudgeCard}
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="stack home">
        {header}
        <div className="card">
          <div className="eyebrow">Who's it for?</div>
          <h2>Add the people you plan with.</h2>
          <p>PlanBuddy plans for your household. Add who is usually along, and their allergies and tastes, in Memory.</p>
          <div className="row-gap">
            <Link to="/memory" className="btn btn-primary">Open Memory</Link>
            <button className="btn btn-ghost" onClick={() => openCustomize()}><SlidersHorizontal size={16} /> Customize</button>
          </div>
        </div>
      </div>
    );
  }

  const chips = (
    <nav className="home-scopes" aria-label="Plan something else">
      <span className="home-scopes__label">Or plan</span>
      <div className="chip-row">
        {SCOPE_CHIPS.filter((chip) => chip.kind !== moment?.kind).map((chip) => (
          <button key={chip.kind} type="button" className="chip home-chip" onClick={() => void switchScope(chip.kind)}>{chip.label}</button>
        ))}
        <button type="button" className="chip home-chip" onClick={tripChip}><Compass size={14} aria-hidden="true" /> Trip</button>
        <Link to="/plan/custom" state={customizeState()} className="chip home-chip home-chip--customize"><SlidersHorizontal size={14} aria-hidden="true" /> Customize</Link>
      </div>
    </nav>
  );

  const proposalBlock = proposal && (
    <section className="home-proposal" aria-label={moment ? `Plan for ${moment.label}` : "Your plan"}>
      {reasonLine && (
        <p className="home-reason"><Sparkles size={15} aria-hidden="true" /> <span>{reasonLine}</span></p>
      )}
      <PlanBrowser
        key={`${proposal.plan.spec.id}:${proposal.lockedPlanId ?? ""}`}
        initial={proposal.plan}
        initialLockedPlanId={proposal.lockedPlanId}
        participants={participants}
        onStartOver={() => openCustomize()}
        startOverLabel="Plan something else"
      />
      {chips}
    </section>
  );

  return (
    <div className="stack home">
      {header}
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}
      {lead === "nudge" && nudgeCard}
      {proposalBlock}
      {lead !== "nudge" && nudgeCard}
    </div>
  );
}

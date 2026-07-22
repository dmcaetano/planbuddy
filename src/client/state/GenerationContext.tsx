import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { PipelineResponse } from "../api/types";
import { useAuth } from "./AuthContext";

// NOTE: only plan creation (POST /plan-specs) and regenerate (POST /plan-specs/:id/regenerate) run
// through the async job system on the server. The free-text "Tweak"/"Edit with Buddy" flow goes
// through POST /plan-specs/:id/chat-action, which the server intentionally kept synchronous (it's
// an AI-interpreted action dispatch, not a plan-generation pipeline run) — so it is NOT modeled as
// a job kind here. If a future async NL-tweak lands, extend JobKind then.
export type JobKind = "generate" | "regenerate" | "edit";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobResult = PipelineResponse;

/** Raw shape returned by GET /plan-jobs/:id and GET /plan-jobs/active. */
interface PlanJobPollResponse {
  jobId: string;
  status: JobStatus;
  stage?: string | null;
  stageLabel?: string | null;
  /** Short, human sentence that updates several times within a stage (e.g. "Composing around
   *  Mosteiro dos Jerónimos, O Frade + 2 more"). Null when the server has nothing more specific
   *  to say than the stage label itself. */
  stageDetail?: string | null;
  progressPct?: number | null;
  startedAt?: string;
  updatedAt?: string;
  result?: JobResult | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface GenerationJob {
  jobId: string;
  kind: JobKind;
  /** The plan-spec this job is tied to. Known up-front for regenerate/tweak; filled in from the result for a fresh generate. */
  specId: string | null;
  status: JobStatus;
  stage?: string | null;
  stageLabel?: string | null;
  stageDetail?: string | null;
  progressPct: number;
  startedAt?: string;
  updatedAt?: string;
  result?: JobResult | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Whether a consumer (PlanPage) has already folded this job's terminal result into its own state.
   *  Distinct from `dismiss()`: a seen job stays in the provider so remounting PlanPage can still
   *  re-fold it, but GenerationBanner stops advertising it as newly ready. */
  seen: boolean;
}

interface StartSpecPayload {
  scale: string;
  startDate: string;
  endDate: string;
  participantIds: string[];
  moodContext: string | null;
}

interface JobHint {
  jobId: string;
  kind: JobKind;
  specId: string | null;
}

interface LastAction {
  kind: JobKind;
  specId: string | null;
  path: string;
  body: Record<string, unknown>;
}

interface GenerationContextValue {
  job: GenerationJob | null;
  connectionWarning: boolean;
  startSpec: (payload: StartSpecPayload) => Promise<void>;
  startRegenerate: (specId: string) => Promise<void>;
  trackJob: (jobId: string, kind: JobKind, specId: string | null) => void;
  retry: () => Promise<void>;
  dismiss: () => void;
  markSeen: () => void;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

function hintKey(userId: string): string {
  return `planbuddy.activeJob.${userId}`;
}

function readHint(userId: string): JobHint | null {
  try {
    const raw = localStorage.getItem(hintKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.jobId === "string") return parsed as JobHint;
    return null;
  } catch {
    return null;
  }
}

function writeHint(userId: string, hint: JobHint) {
  try {
    localStorage.setItem(hintKey(userId), JSON.stringify(hint));
  } catch {
    /* storage unavailable — reattach just won't have a hint to start from */
  }
}

function clearHint(userId: string) {
  try {
    localStorage.removeItem(hintKey(userId));
  } catch {
    /* ignore */
  }
}

function extractSpecId(result?: JobResult | null): string | null {
  return result?.spec?.id ?? null;
}

function isActiveStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

const MAX_BACKOFF_MS = 8000;
const CONNECTION_WARNING_AFTER_MS = 30000;

export function GenerationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;

  const [job, setJob] = useState<GenerationJob | null>(null);
  const [connectionWarning, setConnectionWarning] = useState(false);

  const jobRef = useRef<GenerationJob | null>(null);
  const timerRef = useRef<number | null>(null);
  const failureStartRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const lastActionRef = useRef<LastAction | null>(null);
  const userIdRef = useRef<string | undefined>(userId);
  userIdRef.current = userId;
  // Indirection so scheduleNext/pollOnce can reference each other without a use-before-define cycle.
  const pollFnRef = useRef<((jobId: string) => Promise<void>) | null>(null);
  // Bumped on user change (incl. logout), dismiss(), and provider unmount. An in-flight poll request
  // or an already-armed setTimeout captures the epoch at issue time; if the epoch has moved on by the
  // time the response/timer fires, it's a stale callback from a previous "session" (old user, or a
  // dismissed job) and must not schedule another timer or apply its result to state.
  const epochRef = useRef(0);

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback((jobId: string, overrideDelay?: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const delay = overrideDelay ?? (typeof document !== "undefined" && document.hidden ? 5000 : 1500);
    const epoch = epochRef.current;
    timerRef.current = window.setTimeout(() => {
      // The epoch moved on (user change/logout, dismiss, or unmount) between scheduling and firing —
      // this timer is for a stopped session and must not resurrect polling.
      if (epochRef.current !== epoch) return;
      void pollFnRef.current?.(jobId);
    }, delay);
  }, []);

  const pollOnce = useCallback(
    async (jobId: string) => {
      const epoch = epochRef.current;
      let backoffDelay: number | undefined;
      try {
        const data = await api.get<PlanJobPollResponse>(`/plan-jobs/${jobId}`);
        // The request was in flight when the session stopped (logout/dismiss/unmount/user switch) —
        // never apply a stale response to whatever state exists now.
        if (epochRef.current !== epoch) return;
        failureStartRef.current = null;
        failureCountRef.current = 0;
        setConnectionWarning(false);
        setJob((prev) => {
          if (!prev || prev.jobId !== jobId) return prev;
          const merged: GenerationJob = {
            ...prev,
            status: data.status,
            stage: data.stage,
            stageLabel: data.stageLabel,
            stageDetail: data.stageDetail ?? null,
            progressPct: typeof data.progressPct === "number" ? data.progressPct : prev.progressPct,
            startedAt: data.startedAt ?? prev.startedAt,
            updatedAt: data.updatedAt,
            result: data.result ?? prev.result,
            errorCode: data.errorCode ?? undefined,
            errorMessage: data.errorMessage ?? undefined,
            specId: prev.specId ?? extractSpecId(data.result),
          };
          jobRef.current = merged;
          return merged;
        });
        if (data.status === "succeeded" || data.status === "failed") {
          stopPolling();
          const uid = userIdRef.current;
          if (uid) clearHint(uid);
          return;
        }
      } catch (err) {
        if (epochRef.current !== epoch) return;
        if (err instanceof ApiError && err.status === 404) {
          stopPolling();
          setJob(null);
          jobRef.current = null;
          const uid = userIdRef.current;
          if (uid) clearHint(uid);
          return;
        }
        if (!failureStartRef.current) failureStartRef.current = Date.now();
        failureCountRef.current += 1;
        if (Date.now() - failureStartRef.current > CONNECTION_WARNING_AFTER_MS) {
          setConnectionWarning(true);
        }
        backoffDelay = Math.min(1500 * 2 ** failureCountRef.current, MAX_BACKOFF_MS);
      }

      if (epochRef.current !== epoch) return;
      const current = jobRef.current;
      if (current && current.jobId === jobId && isActiveStatus(current.status)) {
        scheduleNext(jobId, backoffDelay);
      }
    },
    [scheduleNext, stopPolling]
  );

  useEffect(() => {
    pollFnRef.current = pollOnce;
  }, [pollOnce]);

  const startPollingLoop = useCallback(
    (jobId: string) => {
      stopPolling();
      void pollOnce(jobId);
    },
    [pollOnce, stopPolling]
  );

  const adoptJob = useCallback(
    (uid: string, data: PlanJobPollResponse, hint: JobHint | null) => {
      const matchesHint = hint && hint.jobId === data.jobId;
      const kind: JobKind = matchesHint ? hint.kind : "generate";
      const specId = matchesHint ? hint.specId : extractSpecId(data.result);
      const next: GenerationJob = {
        jobId: data.jobId,
        kind,
        specId,
        status: data.status,
        stage: data.stage,
        stageLabel: data.stageLabel,
        stageDetail: data.stageDetail ?? null,
        progressPct: typeof data.progressPct === "number" ? data.progressPct : 0,
        startedAt: data.startedAt,
        updatedAt: data.updatedAt,
        result: data.result,
        errorCode: data.errorCode ?? undefined,
        errorMessage: data.errorMessage ?? undefined,
        seen: false,
      };
      jobRef.current = next;
      setJob(next);
      if (isActiveStatus(next.status)) {
        writeHint(uid, { jobId: next.jobId, kind, specId });
        startPollingLoop(next.jobId);
      } else {
        clearHint(uid);
      }
    },
    [startPollingLoop]
  );

  // Bootstrap / reattach whenever the signed-in user changes (including logout, which clears everything).
  useEffect(() => {
    epochRef.current += 1; // invalidate any poll/timer left over from the previous user/session
    stopPolling();
    setJob(null);
    jobRef.current = null;
    failureStartRef.current = null;
    failureCountRef.current = 0;
    setConnectionWarning(false);

    if (!userId) return;

    let cancelled = false;
    const hint = readHint(userId);

    api
      .get<{ job: PlanJobPollResponse | null }>("/plan-jobs/active")
      .then((data) => {
        if (cancelled) return;
        if (data.job) {
          adoptJob(userId, data.job, hint);
        } else if (hint) {
          clearHint(userId);
        }
      })
      .catch(() => {
        if (cancelled || !hint) return;
        // The authoritative check failed (offline, transient error) — fall back to the local hint so
        // a reload during a flaky connection doesn't silently drop a job the server still has running.
        adoptJob(userId, { jobId: hint.jobId, status: "running", progressPct: 0 }, hint);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Poll immediately when the tab regains visibility/focus, or the connection comes back.
  useEffect(() => {
    function pokeIfActive() {
      const current = jobRef.current;
      if (current && isActiveStatus(current.status)) {
        stopPolling();
        void pollOnce(current.jobId);
      }
    }
    function handleVisibility() {
      if (!document.hidden) pokeIfActive();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", pokeIfActive);
    window.addEventListener("online", pokeIfActive);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", pokeIfActive);
      window.removeEventListener("online", pokeIfActive);
    };
  }, [pollOnce, stopPolling]);

  useEffect(
    () => () => {
      epochRef.current += 1; // provider unmounting — no timer/response fired after this may act
      stopPolling();
    },
    [stopPolling]
  );

  const trackJob = useCallback((jobId: string, kind: JobKind, specId: string | null) => {
    const now = new Date().toISOString();
    const next: GenerationJob = {
      jobId,
      kind,
      specId,
      status: "queued",
      stage: null,
      stageLabel: null,
      stageDetail: null,
      progressPct: 0,
      startedAt: now,
      updatedAt: now,
      seen: false,
    };
    jobRef.current = next;
    setJob(next);
    failureStartRef.current = null;
    failureCountRef.current = 0;
    setConnectionWarning(false);
    const uid = userIdRef.current;
    if (uid) writeHint(uid, { jobId, kind, specId });
    startPollingLoop(jobId);
  }, [startPollingLoop]);

  const startAction = useCallback(
    async (kind: JobKind, specId: string | null, path: string, body: Record<string, unknown>) => {
      const idempotencyKey = crypto.randomUUID();
      lastActionRef.current = { kind, specId, path, body };
      const res = await api.post<{ jobId: string; existing?: boolean }>(path, { ...body, idempotencyKey });
      trackJob(res.jobId, kind, specId);
    },
    [trackJob]
  );

  const startSpec = useCallback(
    (payload: StartSpecPayload) => startAction("generate", null, "/plan-specs", { ...payload }),
    [startAction]
  );

  const startRegenerate = useCallback(
    (specId: string) => startAction("regenerate", specId, `/plan-specs/${specId}/regenerate`, {}),
    [startAction]
  );

  const retry = useCallback(async () => {
    const last = lastActionRef.current;
    if (!last) return;
    await startAction(last.kind, last.specId, last.path, last.body);
  }, [startAction]);

  const dismiss = useCallback(() => {
    epochRef.current += 1; // any poll/timer already in flight for this job must not act after dismiss
    stopPolling();
    setJob(null);
    jobRef.current = null;
    const uid = userIdRef.current;
    if (uid) clearHint(uid);
  }, [stopPolling]);

  // Marks the current job as folded-into-a-consumer without clearing it — unlike dismiss(), the job
  // (and its result) stays available in the provider so a remounted PlanPage can still re-fold it.
  const markSeen = useCallback(() => {
    setJob((prev) => {
      if (!prev || prev.seen) return prev;
      const next: GenerationJob = { ...prev, seen: true };
      jobRef.current = next;
      return next;
    });
  }, []);

  const value: GenerationContextValue = {
    job,
    connectionWarning,
    startSpec,
    startRegenerate,
    trackJob,
    retry,
    dismiss,
    markSeen,
  };

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

export function useGeneration(): GenerationContextValue {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used within GenerationProvider");
  return ctx;
}

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { GENERATION_STAGES, expectedStageDurationMs, stageIndex } from "../state/generationStages";
import { useGeneration, type GenerationJob } from "../state/GenerationContext";

function useElapsedSeconds(startedAt?: string): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

/** Floor/cap for the current stage: where the bar starts, and the honest ceiling it may creep
 *  toward (90% of the way to the next stage's floor) without ever claiming a stage not reached. */
function stageBounds(stage?: string | null): { floor: number; cap: number } {
  const idx = stageIndex(stage);
  if (idx === -1) return { floor: 4, cap: 4 };
  const floor = GENERATION_STAGES[idx].pct;
  const nextFloor = idx < GENERATION_STAGES.length - 1 ? GENERATION_STAGES[idx + 1].pct : 100;
  return { floor, cap: floor + 0.9 * (nextFloor - floor) };
}

/**
 * Eases the displayed progress value from the current stage's floor toward its cap over the
 * stage's expected duration, purely as a client-side visual so long stages don't look frozen.
 * Never exceeds the cap (so it never implies a stage that hasn't started), snaps to the new
 * floor the instant the real stage advances, and pauses the animation loop while the tab is
 * hidden so it doesn't spin in the background.
 */
function useLivingProgress(job: GenerationJob): number {
  const stageEnteredAtRef = useRef<number>(Date.now());
  const lastStageRef = useRef<string | null | undefined>(job.stage);
  const [displayPct, setDisplayPct] = useState<number>(() => {
    const { floor } = stageBounds(job.stage);
    return Math.max(floor, typeof job.progressPct === "number" ? job.progressPct : 0);
  });

  if (lastStageRef.current !== job.stage) {
    lastStageRef.current = job.stage;
    stageEnteredAtRef.current = Date.now();
  }

  useEffect(() => {
    let cancelled = false;
    let rafId: number | null = null;
    let lastUpdate = 0;

    function computeValue(): number {
      const { floor, cap } = stageBounds(job.stage);
      const duration = expectedStageDurationMs(job.stage);
      const elapsed = Date.now() - stageEnteredAtRef.current;
      const fraction = Math.min(1, Math.max(0, elapsed / duration));
      const creep = floor + fraction * (cap - floor);
      const real = typeof job.progressPct === "number" ? job.progressPct : 0;
      // The real server value can legitimately be ahead of our estimate; honor it, but never past
      // this stage's cap (that would visually promise progress into the next stage).
      return Math.min(cap, Math.max(creep, real));
    }

    function tick(now: number) {
      if (cancelled) return;
      if (document.hidden) {
        rafId = null;
        return; // stop scheduling; visibilitychange below resumes us
      }
      if (now - lastUpdate > 200) {
        lastUpdate = now;
        setDisplayPct(computeValue());
      }
      rafId = requestAnimationFrame(tick);
    }

    // Snap immediately to the new stage's floor/real value, then start easing.
    setDisplayPct(computeValue());
    rafId = requestAnimationFrame(tick);

    function handleVisibility() {
      if (!document.hidden && rafId === null && !cancelled) {
        lastUpdate = 0;
        rafId = requestAnimationFrame(tick);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [job.stage, job.progressPct]);

  return displayPct;
}

/** Renders text that crossfades in whenever it changes (remount-on-key drives the CSS fade-in);
 *  prefers-reduced-motion turns the animation off in progress.css, so the swap is instant there. */
function CrossfadeText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className} aria-live="polite">
      <span key={text} className="generation-crossfade">
        {text}
      </span>
    </span>
  );
}

/**
 * Full-page progress experience shown while a plan-generation job (fresh spec or regenerate)
 * is queued/running, and the friendly failed state with retry. Reads live progress from the
 * shared GenerationContext, so it reflects a job however it was picked up (fresh start or
 * reattach after a reload/tab switch).
 */
export default function GenerationProgress({ job }: { job: GenerationJob }) {
  const generation = useGeneration();
  const elapsed = useElapsedSeconds(job.startedAt);
  const currentIndex = stageIndex(job.stage);
  const livingPct = useLivingProgress(job);

  if (job.status === "failed") {
    return (
      <div className="stack">
        <div className="card generation-card generation-card--failed">
          <div className="eyebrow">Couldn't finish</div>
          <h2>{job.errorMessage || "Something went wrong building your plan."}</h2>
          <p className="muted">Nothing was lost — your details are still filled in.</p>
          <button className="btn btn-primary" onClick={() => void generation.retry()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const reassurance =
    elapsed >= 180
      ? "Taking longer than usual — the providers are busy. Hang tight or check back in a minute."
      : elapsed >= 90
        ? "Still working — thorough beats fast. You can browse other tabs."
        : "You can browse other tabs — I'll keep working.";

  return (
    <div className="stack">
      <div className="card generation-card">
        <div className="eyebrow">Building your route</div>
        <h2 aria-live="polite">{job.stageLabel || "Getting started…"}</h2>
        <div
          className="generation-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(livingPct)}
          aria-label="Plan generation progress"
        >
          <div className="generation-progress-bar__fill" style={{ width: `${Math.min(100, Math.max(4, livingPct))}%` }} />
        </div>
        <ol className="generation-stage-list">
          {GENERATION_STAGES.map((stage, index) => {
            const status = currentIndex === -1 ? "upcoming" : index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
            return (
              <li key={stage.id} className={`generation-stage generation-stage--${status}`}>
                <span className="generation-stage__marker" aria-hidden="true">
                  {status === "done" ? <Check size={14} /> : <span className="generation-stage__dot" />}
                </span>
                <span className="generation-stage__row">
                  <span>{stage.label}</span>
                  {status === "current" && job.stageDetail && (
                    <CrossfadeText text={job.stageDetail} className="generation-stage__detail" />
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="generation-elapsed">{elapsed}s — good plans take a moment.</p>
        <p className="generation-reassurance">{reassurance}</p>
        {generation.connectionWarning && (
          <p className="generation-connection-warning" role="alert">
            Having trouble reaching PlanBuddy, but your plan is still building. Keep this tab open a little longer.
          </p>
        )}
      </div>
      <div className="skeleton generation-skeleton" style={{ height: 160, borderRadius: 14 }} aria-hidden="true" />
    </div>
  );
}

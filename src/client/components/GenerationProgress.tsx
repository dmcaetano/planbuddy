import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { GENERATION_STAGES, stageIndex } from "../state/generationStages";
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
  const pct = typeof job.progressPct === "number" && job.progressPct > 0
    ? job.progressPct
    : currentIndex >= 0
      ? GENERATION_STAGES[currentIndex].pct
      : 4;

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
          aria-valuenow={Math.round(pct)}
          aria-label="Plan generation progress"
        >
          <div className="generation-progress-bar__fill" style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
        </div>
        <ol className="generation-stage-list">
          {GENERATION_STAGES.map((stage, index) => {
            const status = currentIndex === -1 ? "upcoming" : index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
            return (
              <li key={stage.id} className={`generation-stage generation-stage--${status}`}>
                <span className="generation-stage__marker" aria-hidden="true">
                  {status === "done" ? <Check size={14} /> : <span className="generation-stage__dot" />}
                </span>
                <span>{stage.label}</span>
              </li>
            );
          })}
        </ol>
        <p className="generation-elapsed">{elapsed}s — good plans take a moment.</p>
        <p className="generation-reassurance">You can browse other tabs — I'll keep working.</p>
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

import { useEffect } from "react";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGeneration } from "../state/GenerationContext";
import { GENERATION_STAGES, stageIndex } from "../state/generationStages";

/**
 * Compact fixed banner shown whenever a plan-generation job is active, just finished, or has
 * failed, and the user isn't currently on /plan. Tapping the main area jumps to /plan, where
 * GenerationProgress (or the finished result) takes over. A failed job stays visible — it is
 * NOT auto-hidden — until the user taps through to /plan and resolves it (retry/replace) there,
 * or dismisses it directly from the banner; that's what keeps a server-side failure from being
 * silently swallowed when the user isn't on the Plan page to see it.
 */
export default function GenerationBanner() {
  const { job, connectionWarning, dismiss } = useGeneration();
  const navigate = useNavigate();
  const location = useLocation();

  const visible = Boolean(job) && location.pathname !== "/plan" && !(job?.status === "succeeded" && job?.seen);

  // The banner is fixed-position and can outlive the page it appeared over (e.g. a job that
  // resolves while the user is on History/Memory/Chat and never returns to /plan to mark it
  // seen). Reserve extra bottom clearance on whatever page is showing so the banner never sits
  // on top of real, clickable content — only while it's actually visible, so normal pages keep
  // their usual (smaller) bottom padding.
  useEffect(() => {
    document.body.classList.toggle("has-generation-banner", visible);
    return () => {
      document.body.classList.remove("has-generation-banner");
    };
  }, [visible]);

  if (!visible || !job) return null;

  const failed = job.status === "failed";
  const ready = job.status === "succeeded";
  const currentIndex = stageIndex(job.stage);
  const pct = ready
    ? 100
    : typeof job.progressPct === "number" && job.progressPct > 0
      ? job.progressPct
      : currentIndex >= 0
        ? GENERATION_STAGES[currentIndex].pct
        : 4;

  return (
    <div className={`generation-banner ${failed ? "generation-banner--failed" : ""}`} aria-live="polite">
      <button type="button" className="generation-banner__main" onClick={() => navigate("/plan")}>
        <div className="generation-banner__text">
          <strong>{failed ? "Plan hit a snag" : ready ? "Your plan is ready" : job.stageLabel || "Building your plan…"}</strong>
          <span className="generation-banner__hint">
            {failed
              ? "Tap to see what happened"
              : ready
                ? "Tap to see it"
                : connectionWarning
                  ? "Still working — reconnecting…"
                  : "You can keep browsing"}
          </span>
        </div>
        <div className="generation-banner__right">
          {failed ? (
            <AlertTriangle size={16} aria-hidden="true" />
          ) : (
            <>
              <div className="generation-banner__bar" aria-hidden="true">
                <div className="generation-banner__bar-fill" style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </div>
      </button>
      {failed && (
        <button type="button" className="generation-banner__dismiss" aria-label="Dismiss" onClick={() => dismiss()}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

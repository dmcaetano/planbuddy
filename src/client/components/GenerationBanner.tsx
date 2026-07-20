import { ArrowRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGeneration } from "../state/GenerationContext";
import { GENERATION_STAGES, stageIndex } from "../state/generationStages";

/**
 * Compact fixed banner shown whenever a plan-generation job is active (or just finished) and the
 * user isn't currently on /plan. Tapping it jumps to /plan, where GenerationProgress (or the
 * finished result) takes over.
 */
export default function GenerationBanner() {
  const { job, connectionWarning } = useGeneration();
  const navigate = useNavigate();
  const location = useLocation();

  if (!job) return null;
  if (location.pathname === "/plan") return null;
  if (job.status === "failed") return null;
  if (job.status === "succeeded" && job.seen) return null;

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
    <button type="button" className="generation-banner" onClick={() => navigate("/plan")} aria-live="polite">
      <div className="generation-banner__text">
        <strong>{ready ? "Your plan is ready" : job.stageLabel || "Building your plan…"}</strong>
        <span className="generation-banner__hint">
          {ready ? "Tap to see it" : connectionWarning ? "Still working — reconnecting…" : "You can keep browsing"}
        </span>
      </div>
      <div className="generation-banner__right">
        <div className="generation-banner__bar" aria-hidden="true">
          <div className="generation-banner__bar-fill" style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
        </div>
        <ArrowRight size={16} aria-hidden="true" />
      </div>
    </button>
  );
}

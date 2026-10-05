import { Compass, MapPin } from "lucide-react";
import type { TripIdea, TripNudge } from "@shared/momentTypes";

interface TripNudgeCardProps {
  nudge: TripNudge;
  /** True when the nudge leads the screen (weekend moment with a time-off range, spec rule 22c). */
  lead?: boolean;
  /** Disables the buttons while a request is in flight. */
  busy?: boolean;
  onPickIdea: (idea: TripIdea) => void;
  onNotNow: () => void;
  onOtherIdeas: () => void;
  /** Only used when `lead` is set: the one-tap way back to the weekend plan. */
  onPlanThisWeekend?: () => void;
}

/** The trip nudge: a line built from stored facts plus up to two ideas, each labelled as an idea, never a fact. */
export default function TripNudgeCard({ nudge, lead = false, busy = false, onPickIdea, onNotNow, onOtherIdeas, onPlanThisWeekend }: TripNudgeCardProps) {
  return (
    <section className={`card trip-nudge ${lead ? "trip-nudge--lead" : ""}`} aria-label="Trip idea">
      <div className="eyebrow"><Compass size={13} aria-hidden="true" /> Time off coming up</div>
      {lead ? <h2 className="trip-nudge__line">{nudge.line}</h2> : <p className="trip-nudge__line trip-nudge__line--small">{nudge.line}</p>}
      <ul className="trip-nudge__ideas">
        {nudge.ideas.map((idea) => (
          <li key={`${idea.scope}:${idea.name}`}>
            <button type="button" className="trip-nudge__idea" disabled={busy} onClick={() => onPickIdea(idea)}>
              <span className="trip-nudge__idea-tag">Idea</span>
              <span className="trip-nudge__idea-name"><MapPin size={14} aria-hidden="true" /> {idea.name}</span>
              <span className="trip-nudge__idea-reason">{idea.reason}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row-gap">
        {lead && onPlanThisWeekend && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onPlanThisWeekend}>Plan this weekend</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onOtherIdeas}>{nudge.ideas.length === 0 ? "Show ideas" : "Other ideas"}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onNotNow}>Not now</button>
      </div>
    </section>
  );
}

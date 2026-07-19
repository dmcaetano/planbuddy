import { CloudRain, MapPin, Quote, Sparkles } from "lucide-react";
import type { PlanView } from "../api/types";

function fitLabel(score: number): string {
  if (score >= 0.75) return "Strong fit";
  if (score >= 0.55) return "Good fit";
  if (score >= 0.4) return "Fair fit";
  return "Loose fit";
}

export default function TicketCard({ view }: { view: PlanView }) {
  const { candidate, weather, placeProvenance, activeConstraints } = view;
  return (
    <div className="ticket-card">
      <div className="ticket-card__top">
        <div className="eyebrow">{candidate.category}</div>
        <h2>{candidate.title}</h2>
        <div className="row-gap" style={{ marginBottom: "var(--space-3)" }}>
          <span className="badge badge-pine">
            <Sparkles size={12} /> {fitLabel(candidate.scoreBreakdown.groupFit)}
          </span>
          <span className="badge badge-sky">{candidate.indoor ? "Indoor" : "Outdoor"}</span>
          {weather.unavailable ? (
            <span className="badge badge-honey">
              <CloudRain size={12} /> Weather unavailable
            </span>
          ) : (
            <span className="badge badge-honey">
              <CloudRain size={12} /> {weather.summary}
            </span>
          )}
          {candidate.travelEstimateKm != null && (
            <span className="badge badge-sky">
              <MapPin size={12} /> ~{candidate.travelEstimateKm} km
            </span>
          )}
        </div>
        <p>{candidate.rationale}</p>

        {candidate.destinationAnchor && (
          <p className="muted">
            <MapPin size={13} /> Destination: {candidate.destinationAnchor}
          </p>
        )}

        {candidate.citations.length > 0 && (
          <div className="stack" style={{ marginTop: "var(--space-2)" }}>
            {candidate.citations.map((c, i) => (
              <div key={i} className="muted" style={{ display: "flex", gap: 6 }}>
                <Quote size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  "{c.quote}" <em>— {c.source}</em>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ticket-card__perforation" />

      <div className="ticket-card__bottom">
        <div className="eyebrow">The plan</div>
        {candidate.beats.map((beat, i) => (
          <div className="beat" key={i}>
            <h4>{beat.title}</h4>
            <p>{beat.description}</p>
          </div>
        ))}

        {activeConstraints.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: "var(--space-3)" }}>
              Active constraints honored
            </div>
            <div className="chip-row">
              {activeConstraints.map((c) => (
                <span key={c.id} className={`badge ${c.status === "verified" ? "badge-pine" : "badge-honey"}`}>
                  {c.text}
                </span>
              ))}
            </div>
          </>
        )}

        <p className="muted" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>
          {placeProvenance.note}
        </p>
      </div>
    </div>
  );
}

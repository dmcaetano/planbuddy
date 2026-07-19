import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CloudRain,
  ExternalLink,
  Footprints,
  MapPin,
  Navigation,
  PawPrint,
  Quote,
  Shirt,
  Sparkles,
  SunMedium,
} from "lucide-react";
import type { PlanView } from "../api/types";

function fitLabel(score: number): string {
  if (score >= 0.75) return "Strong fit";
  if (score >= 0.55) return "Good fit";
  if (score >= 0.4) return "Fair fit";
  return "Loose fit";
}

function DetailList({ items }: { items: string[] }) {
  return (
    <ul className="detail-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function eventDateLabel(startDate?: string, endDate?: string): string | null {
  if (!startDate) return null;
  const format = (value: string) =>
    new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(
      new Date(`${value}T12:00:00`)
    );
  return endDate && endDate !== startDate ? `${format(startDate)}–${format(endDate)}` : format(startDate);
}

export default function TicketCard({
  view,
  eventStartDate,
  eventEndDate,
}: {
  view: PlanView;
  eventStartDate?: string;
  eventEndDate?: string;
}) {
  const { candidate, weather, placeProvenance, activeConstraints } = view;
  const dateLabel = eventDateLabel(eventStartDate, eventEndDate);
  return (
    <article className="ticket-card">
      {candidate.heroImage && (
        <figure className="ticket-hero">
          <img
            src={candidate.heroImage.url}
            alt={candidate.heroImage.caption}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          <figcaption>
            {candidate.heroImage.caption} ·{" "}
            <a href={candidate.heroImage.sourceUrl} target="_blank" rel="noreferrer">
              {candidate.heroImage.attribution}
            </a>
          </figcaption>
        </figure>
      )}

      <div className="ticket-card__top">
        <div className="eyebrow">{candidate.category}{dateLabel ? ` · ${dateLabel}` : ""}</div>
        <h2>{candidate.title}</h2>
        <div className="row-gap ticket-badges">
          <span className="badge badge-pine">
            <Sparkles size={12} /> {fitLabel(candidate.scoreBreakdown.groupFit)}
          </span>
          <span className="badge badge-sky">{candidate.indoor ? "Mostly indoor" : "Mostly outdoors"}</span>
          <span className="badge badge-honey">
            <CloudRain size={12} /> {weather.unavailable ? "Forecast unavailable" : weather.summary}
          </span>
          {weather.sunset && (
            <span className="badge badge-clay">
              <SunMedium size={12} /> Sunset {weather.sunset}
            </span>
          )}
        </div>
        <p className="ticket-rationale">{candidate.rationale}</p>

        <div className="plan-metrics">
          {candidate.walkingDistanceKm != null && (
            <div>
              <Footprints size={17} />
              <span>
                <strong>~{candidate.walkingDistanceKm} km</strong>
                <small>{candidate.walkingMinutes ? `${candidate.walkingMinutes} min walking` : "estimated walk"}</small>
              </span>
            </div>
          )}
          {candidate.estimatedCost && (
            <div>
              <CircleDollarSign size={17} />
              <span>
                <strong>{candidate.estimatedCost}</strong>
                <small>estimated spend</small>
              </span>
            </div>
          )}
          {candidate.routeMapsUrl && (
            <a href={candidate.routeMapsUrl} target="_blank" rel="noreferrer">
              <Navigation size={17} />
              <span>
                <strong>Open full route</strong>
                <small>live in Google Maps</small>
              </span>
            </a>
          )}
        </div>

        {candidate.citations.length > 0 && (
          <div className="memory-citations">
            {candidate.citations.map((citation, index) => (
              <div key={index}>
                <Quote size={13} />
                <span>
                  “{citation.quote}” <em>— {citation.source}</em>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ticket-card__perforation" />

      <div className="ticket-card__bottom">
        <div className="section-kicker-row">
          <div className="eyebrow">Your itinerary</div>
          <span>Times & distances are estimates</span>
        </div>
        <div className="itinerary">
          {candidate.beats.map((beat, index) => (
            <section className="itinerary-stop" key={index}>
              <div className="itinerary-stop__rail">
                <span>{index + 1}</span>
              </div>
              <div className="itinerary-stop__content">
                <div className="itinerary-stop__meta">
                  {beat.startTime && (
                    <span>
                      <Clock3 size={13} /> {beat.startTime}
                    </span>
                  )}
                  {beat.durationMinutes && <span>{beat.durationMinutes} min</span>}
                  {beat.distanceFromPreviousKm != null && (
                    <span>
                      ~{beat.distanceFromPreviousKm} km · {beat.travelMinutes ?? "?"} min {beat.travelMode ?? "travel"}
                    </span>
                  )}
                </div>
                <h3>{beat.title}</h3>
                {beat.place && (
                  <div className="place-block">
                    <strong>
                      <MapPin size={15} /> {beat.place.name}
                    </strong>
                    {beat.place.address && <span>{beat.place.address}</span>}
                    <p>{beat.place.factualNote}</p>
                    <div className="place-actions">
                      {beat.place.mapsUrl && (
                        <a href={beat.place.mapsUrl} target="_blank" rel="noreferrer">
                          Maps & photos <ExternalLink size={13} />
                        </a>
                      )}
                      {beat.directionsUrl && (
                        <a href={beat.directionsUrl} target="_blank" rel="noreferrer">
                          Directions <Navigation size={13} />
                        </a>
                      )}
                      <a href={beat.place.sourceUrl} target="_blank" rel="noreferrer">
                        {beat.place.sourceLabel} <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                )}
                <p className="stop-description">{beat.description}</p>
              </div>
            </section>
          ))}
        </div>

        {candidate.preparation && (
          <div className="prep-grid">
            <section className="prep-panel">
              <h3>
                <Shirt size={17} /> What to wear
              </h3>
              <DetailList items={candidate.preparation.wear} />
              {candidate.preparation.bring.length > 0 && (
                <>
                  <h4>Bring</h4>
                  <DetailList items={candidate.preparation.bring} />
                </>
              )}
            </section>
            {candidate.preparation.pet.length > 0 && (
              <section className="prep-panel prep-panel--pet">
                <h3>
                  <PawPrint size={17} /> For your pet
                </h3>
                <DetailList items={candidate.preparation.pet} />
              </section>
            )}
            <p className="weather-rule">{candidate.preparation.weatherRule}</p>
          </div>
        )}

        {candidate.checkBeforeYouGo.length > 0 && (
          <section className="check-panel">
            <h3>
              <CheckCircle2 size={17} /> Confirm before leaving
            </h3>
            <DetailList items={candidate.checkBeforeYouGo} />
          </section>
        )}

        {candidate.fallback && (
          <section className="fallback-panel">
            <div className="eyebrow">Compact fallback</div>
            <h3>{candidate.fallback.title}</h3>
            <p>{candidate.fallback.description}</p>
            {candidate.fallback.place?.mapsUrl && (
              <a href={candidate.fallback.place.mapsUrl} target="_blank" rel="noreferrer">
                <MapPin size={14} /> Open {candidate.fallback.place.name} in Maps
              </a>
            )}
          </section>
        )}

        {activeConstraints.length > 0 && (
          <section className="constraint-strip">
            <div className="eyebrow">Constraints honored</div>
            <div className="chip-row">
              {activeConstraints.map((constraint) => (
                <span
                  key={constraint.id}
                  className={`badge ${constraint.status === "verified" ? "badge-pine" : "badge-honey"}`}
                >
                  {constraint.text}
                </span>
              ))}
            </div>
          </section>
        )}

        <p className="provenance-note">{placeProvenance.note}</p>
      </div>
    </article>
  );
}

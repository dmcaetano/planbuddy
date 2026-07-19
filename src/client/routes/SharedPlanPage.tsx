import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Candidate, WeatherSnapshot } from "../api/types";
import { api, ApiError } from "../api/client";
import { useAuth } from "../state/AuthContext";
import TicketCard from "../components/TicketCard";

interface SharedSnapshot {
  title: string;
  startDate: string;
  endDate: string;
  candidate: Candidate;
  weather: WeatherSnapshot;
  placeProvenance: { mode: "inspiration" | "resolved"; note: string };
}

export default function SharedPlanPage() {
  const { token = "" } = useParams();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ snapshot: SharedSnapshot }>(`/shares/${token}`)
      .then((data) => setSnapshot(data.snapshot))
      .catch((err) => setError(err instanceof ApiError ? err.message : "This shared plan is unavailable."));
  }, [token]);

  return (
    <div className="public-plan-page">
      <header className="shared-plan-header"><div className="brand-mark">PlanBuddy</div><span>Shared itinerary</span></header>
      {error && <div className="card"><div className="eyebrow">Unavailable</div><h1>This shared plan can't be opened.</h1><p>The link may have expired or been revoked.</p></div>}
      {!snapshot && !error && <div className="skeleton" style={{ height: 360, borderRadius: 18 }} />}
      {snapshot && <TicketCard view={{ candidate: snapshot.candidate, weather: snapshot.weather, placeProvenance: snapshot.placeProvenance, activeConstraints: [] }} eventStartDate={snapshot.startDate} eventEndDate={snapshot.endDate} />}
      <section className="shared-plan-cta"><div><strong>Make plans this detailed in one click.</strong><span>PlanBuddy remembers what works and keeps private memory private.</span></div><Link className="btn btn-primary" to={user ? "/plan" : "/"}>{user ? "Open PlanBuddy" : "Create your PlanBuddy"}</Link></section>
    </div>
  );
}

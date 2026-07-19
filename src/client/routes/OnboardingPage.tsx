import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { api, ApiError } from "../api/client";
import type { Participant } from "../api/types";
import { PawPrint, User, Plus, MapPin } from "lucide-react";

interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  country: string | null;
}

export default function OnboardingPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Step 0: home base
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get<{ results: GeocodeResult[] }>(`/weather/geocode?q=${encodeURIComponent(query)}`);
        setResults(data.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  async function chooseHomeBase(r: GeocodeResult) {
    setError(null);
    try {
      const data = await api.put<{ user: typeof user }>("/auth/home-base", { label: r.label, lat: r.lat, lng: r.lng });
      if (data.user) setUser(data.user);
      setStep(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your home base.");
    }
  }

  // Step 1: participants
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"person" | "pet">("person");

  useEffect(() => {
    if (step === 1) {
      api.get<{ participants: Participant[] }>("/participants").then((d) => setParticipants(d.participants));
    }
  }, [step]);

  async function addParticipant() {
    if (!newName.trim()) return;
    const data = await api.post<{ participant: Participant }>("/participants", { name: newName.trim(), kind: newKind });
    setParticipants((prev) => [...prev, data.participant]);
    setNewName("");
  }

  if (step === 0) {
    return (
      <div className="centered-page">
        <div className="auth-card">
          <div className="eyebrow">Step 1 of 2</div>
          <h1>Where are you based?</h1>
          <p>We use this for weather and distance — nothing else.</p>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="city">Home city</label>
            <input
              id="city"
              placeholder="Search a city…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {searching && <p className="muted">Searching…</p>}
          <div className="stack">
            {results.map((r) => (
              <button
                key={`${r.label}-${r.lat}`}
                type="button"
                className="btn btn-ghost btn-block"
                style={{ justifyContent: "flex-start" }}
                onClick={() => chooseHomeBase(r)}
              >
                <MapPin size={16} /> {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="centered-page">
        <div className="auth-card">
          <div className="eyebrow">Step 2 of 2</div>
          <h1>Who's usually along?</h1>
          <p>Add the people (and pets) you plan for. You can always edit this later in Memory.</p>
          <div className="stack" style={{ marginBottom: "var(--space-4)" }}>
            {participants.map((p) => (
              <div className="list-item" key={p.id}>
                <span className="row-gap" style={{ alignItems: "center" }}>
                  {p.kind === "pet" ? <PawPrint size={16} /> : <User size={16} />} {p.name}
                  {p.isOwner && <span className="badge badge-pine">You</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="row-gap" style={{ marginBottom: "var(--space-3)" }}>
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: "10px 12px" }}
            />
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as "person" | "pet")}
              style={{ border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: "10px 12px" }}
            >
              <option value="person">Person</option>
              <option value="pet">Pet</option>
            </select>
            <button type="button" className="btn btn-secondary" onClick={addParticipant}>
              <Plus size={16} />
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => navigate("/plan")}>
            Start planning
          </button>
        </div>
      </div>
    );
  }

  return null;
}

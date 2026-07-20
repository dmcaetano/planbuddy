import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { api, ApiError } from "../api/client";
import type { Participant } from "../api/types";
import { PawPrint, User, Plus, MapPin, Sparkles } from "lucide-react";
import TasteQuiz from "../components/TasteQuiz";

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
  const [showQuiz, setShowQuiz] = useState(false);

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
                className="btn btn-ghost btn-block justify-start"
                onClick={() => chooseHomeBase(r)}
              >
                <MapPin size={16} /> {r.label}
              </button>
            ))}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="empty-state">No places found — try a broader name.</div>
            )}
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
          <div className="stack mb-4">
            {participants.length === 0 && <div className="empty-state">Nobody added yet — add the people (and pets) you plan for below.</div>}
            {participants.map((p) => (
              <div className="list-item" key={p.id}>
                <span className="row">
                  {p.kind === "pet" ? <PawPrint size={16} /> : <User size={16} />} {p.name}
                  {p.isOwner && <span className="badge badge-pine">You</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="row-gap mb-3">
            <input
              className="input grow"
              aria-label="Name"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <select
              className="select"
              aria-label="Participant type"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as "person" | "pet")}
            >
              <option value="person">Person</option>
              <option value="pet">Pet</option>
            </select>
            <button type="button" className="btn btn-secondary" onClick={addParticipant} aria-label="Add participant">
              <Plus size={16} />
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setStep(2)}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    if (showQuiz) {
      return (
        <div className="centered-page">
          <TasteQuiz
            onSkip={() => navigate("/plan")}
            primaryActionLabel="See them in Memory"
            onPrimaryAction={() => navigate("/memory")}
            secondaryActionLabel="Plan a day"
            onSecondaryAction={() => navigate("/plan")}
          />
        </div>
      );
    }
    return (
      <div className="centered-page">
        <div className="auth-card">
          <div className="eyebrow">Optional</div>
          <h1>Build your fun profile</h1>
          <p>10 quick taps, skippable — helps PlanBuddy suggest days you'll actually love.</p>
          <div className="stack">
            <button type="button" className="btn btn-primary btn-block" onClick={() => setShowQuiz(true)}>
              <Sparkles size={16} /> Start the quiz
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate("/plan")}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

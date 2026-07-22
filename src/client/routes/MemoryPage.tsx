import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Constraint, Hunch, Participant, Taste } from "../api/types";
import { Check, LogOut, MapPin, Plus, ShieldCheck, ShieldQuestion, Sparkles, Trash2, X } from "lucide-react";
import CitySearch from "../components/CitySearch";
import { Link, useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { SkeletonList } from "../components/Skeleton";
import TasteQuiz from "../components/TasteQuiz";
import { useAuth } from "../state/AuthContext";

type Tab = "constraints" | "tastes" | "hunches";

export default function MemoryPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>("constraints");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [tastes, setTastes] = useState<Taste[]>([]);
  const [hunches, setHunches] = useState<Hunch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQuiz, setShowQuiz] = useState(false);
  const [editingHomeBase, setEditingHomeBase] = useState(false);

  async function loadAll() {
    const [p, c, t, h] = await Promise.all([
      api.get<{ participants: Participant[] }>("/participants"),
      api.get<{ constraints: Constraint[] }>("/constraints"),
      api.get<{ tastes: Taste[] }>("/tastes"),
      api.get<{ hunches: Hunch[] }>("/hunches"),
    ]);
    setParticipants(p.participants);
    setConstraints(c.constraints);
    setTastes(t.tastes);
    setHunches(h.hunches);
  }

  useEffect(() => {
    loadAll()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load Memory."))
      .finally(() => setLoading(false));
  }, []);

  function participantName(id: string | null): string {
    if (!id) return "Household";
    return participants.find((p) => p.id === id)?.name ?? "Household";
  }

  // Constraint form
  const [cText, setCText] = useState("");
  const [cParticipant, setCParticipant] = useState<string>("");
  async function addConstraint() {
    if (!cText.trim()) return;
    const data = await api.post<{ constraint: Constraint }>("/constraints", {
      text: cText.trim(),
      participantId: cParticipant || null,
    });
    setConstraints((prev) => [data.constraint, ...prev]);
    setCText("");
  }
  async function removeConstraint(id: string) {
    await api.delete(`/constraints/${id}`);
    setConstraints((prev) => prev.filter((c) => c.id !== id));
  }
  async function confirmConstraint(id: string) {
    const data = await api.post<{ constraint: Constraint }>(`/constraints/${id}/confirm`);
    setConstraints((prev) => prev.map((c) => (c.id === id ? data.constraint : c)));
  }

  // Taste form
  const [tText, setTText] = useState("");
  const [tParticipant, setTParticipant] = useState<string>("");
  const [tPolarity, setTPolarity] = useState<"love" | "avoid">("love");
  async function addTaste() {
    if (!tText.trim()) return;
    const data = await api.post<{ taste: Taste }>("/tastes", {
      text: tText.trim(),
      participantId: tParticipant || null,
      polarity: tPolarity,
    });
    setTastes((prev) => [data.taste, ...prev]);
    setTText("");
  }
  async function removeTaste(id: string) {
    await api.delete(`/tastes/${id}`);
    setTastes((prev) => prev.filter((t) => t.id !== id));
  }

  async function actOnHunch(id: string, action: "confirm" | "dismiss") {
    const data = await api.post<{ hunch: Hunch }>(`/hunches/${id}`, { action });
    setHunches((prev) => prev.map((h) => (h.id === id ? data.hunch : h)));
  }

  // Account / logout
  const [loggingOut, setLoggingOut] = useState(false);
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await auth.logout();
      // AuthContext clears the user; App re-renders straight to AuthPage — no navigate needed,
      // but GenerationContext's own user-change epoch effect handles clearing its job/polling.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log out. Please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Memory</div>
        <h1>What PlanBuddy knows</h1>
        <div className="row-gap mb-2">
          <Link to="/friends" className="btn btn-ghost btn-sm"><Users size={16} /> Friends & invites</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowQuiz(true)}>
            <Sparkles size={16} /> Fun profile quiz
          </button>
        </div>
        <p>Every constraint, taste, and hunch is visible and editable — nothing learns silently.</p>
      </div>

      <div className="card home-base-card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="eyebrow">Home base</div>
            <p className="mb-0">
              <MapPin size={14} /> {auth.user?.homeBaseLabel ?? "Not set — plans need a home base"}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingHomeBase((v) => !v)}>
            {editingHomeBase ? "Cancel" : auth.user?.homeBaseLabel ? "Change" : "Set it"}
          </button>
        </div>
        {editingHomeBase && (
          <div className="mt-2">
            <CitySearch
              placeholder="Search for your home city"
              autoFocus
              onChoose={async (choice) => {
                try {
                  const data = await api.put<{ user: NonNullable<typeof auth.user> }>("/auth/home-base", choice);
                  if (data.user) auth.setUser(data.user);
                  setEditingHomeBase(false);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not save your home base.");
                }
              }}
            />
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showQuiz && (
        <TasteQuiz
          intro="Retaking replaces your previous fun-profile answers — nothing else is touched."
          onSkip={() => setShowQuiz(false)}
          primaryActionLabel="See them below"
          onPrimaryAction={() => {
            setShowQuiz(false);
            setTab("tastes");
            loadAll().catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't refresh Memory."));
          }}
          secondaryActionLabel="Plan a day"
          onSecondaryAction={() => navigate("/plan")}
        />
      )}

      {!showQuiz && loading ? (
        <SkeletonList rows={3} lines={2} label="Loading memory" />
      ) : !showQuiz && (
        <>
      <div className="tab-row" role="tablist">
        <button className={tab === "constraints" ? "active" : ""} onClick={() => setTab("constraints")}>
          Constraints
        </button>
        <button className={tab === "tastes" ? "active" : ""} onClick={() => setTab("tastes")}>
          Tastes
        </button>
        <button className={tab === "hunches" ? "active" : ""} onClick={() => setTab("hunches")}>
          Hunches
        </button>
      </div>

      {tab === "constraints" && (
        <div className="stack">
          <div className="card">
            <div className="field">
              <label>New hard constraint</label>
              <input placeholder="e.g. No shellfish — allergy" value={cText} onChange={(e) => setCText(e.target.value)} />
            </div>
            <div className="row-gap">
              <select className="select grow" value={cParticipant} onChange={(e) => setCParticipant(e.target.value)}>
                <option value="">Household (everyone)</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={addConstraint}>
                <Plus size={16} /> Add
              </button>
            </div>
          </div>

          {constraints.length === 0 && <div className="empty-state">No constraints yet — add one above so PlanBuddy always respects it.</div>}
          {constraints.map((c) => (
            <div className="card" key={c.id}>
              <div className="list-item list-item--plain">
                <div>
                  <div className="row mb-1">
                    {c.status === "verified" ? (
                      <span className="badge badge-pine">
                        <ShieldCheck size={12} /> Verified
                      </span>
                    ) : (
                      <span className="badge badge-honey">
                        <ShieldQuestion size={12} /> Unverified quote
                      </span>
                    )}
                    <span className="badge badge-sky">{participantName(c.participantId)}</span>
                  </div>
                  <strong>{c.text}</strong>
                  {c.sourceQuote && <p className="muted">Source quote: "{c.sourceQuote}"</p>}
                </div>
                <div className="row-gap">
                  {c.status === "active_unverified" && (
                    <button className="icon-btn" title="Confirm" onClick={() => confirmConstraint(c.id)}>
                      <Check size={18} />
                    </button>
                  )}
                  <button className="icon-btn" title="Delete" onClick={() => removeConstraint(c.id)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "tastes" && (
        <div className="stack">
          <div className="card">
            <div className="field">
              <label>New taste</label>
              <input placeholder="e.g. loves live music" value={tText} onChange={(e) => setTText(e.target.value)} />
            </div>
            <div className="row-gap">
              <select className="select" value={tParticipant} onChange={(e) => setTParticipant(e.target.value)}>
                <option value="">Household (everyone)</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="select" value={tPolarity} onChange={(e) => setTPolarity(e.target.value as "love" | "avoid")}>
                <option value="love">Loves</option>
                <option value="avoid">Avoids</option>
              </select>
              <button className="btn btn-primary" onClick={addTaste}>
                <Plus size={16} /> Add
              </button>
            </div>
          </div>

          {tastes.length === 0 && <div className="empty-state">No tastes yet — add one above so plans reflect what people actually like.</div>}
          {tastes.map((t) => (
            <div className="card" key={t.id}>
              <div className="list-item list-item--plain">
                <div>
                  <div className="row mb-1">
                    <span className={`badge ${t.polarity === "love" ? "badge-pine" : "badge-clay"}`}>
                      {t.polarity === "love" ? "Loves" : "Avoids"}
                    </span>
                    <span className="badge badge-sky">{participantName(t.participantId)}</span>
                    <span className="muted">{t.source}</span>
                  </div>
                  <strong>{t.text}</strong>
                </div>
                <button className="icon-btn" title="Delete" onClick={() => removeTaste(t.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "hunches" && (
        <div className="stack">
          {hunches.length === 0 && <div className="empty-state">No hunches yet — they form quietly from feedback and rejections.</div>}
          {hunches.map((h) => (
            <div className="card" key={h.id}>
              <div className="list-item list-item--plain">
                <div>
                  <div className="row mb-1">
                    <span className={`badge ${h.polarity === "love" ? "badge-pine" : "badge-clay"}`}>
                      {h.polarity === "love" ? "Maybe loves" : "Maybe avoids"}
                    </span>
                    <span className="badge badge-sky">{participantName(h.participantId)}</span>
                    <span className="muted">confidence {Math.round(h.confidence * 100)}% · {h.evidenceCount} evidence event(s)</span>
                  </div>
                  <strong>{h.text}</strong>
                  <p className="muted">Never appears in rationales; contributes at most ±0.15 to fit; decays without reinforcement.</p>
                </div>
                {h.status === "active" && (
                  <div className="row-gap">
                    <button className="icon-btn" title="Confirm" onClick={() => actOnHunch(h.id, "confirm")}>
                      <Check size={18} />
                    </button>
                    <button className="icon-btn" title="Dismiss" onClick={() => actOnHunch(h.id, "dismiss")}>
                      <X size={18} />
                    </button>
                  </div>
                )}
                {h.status !== "active" && <span className="badge badge-sky">{h.status}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}

      <div className="memory-account-row">
        <span className="memory-account-row__email">{auth.user?.email}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout} disabled={loggingOut}>
          <LogOut size={14} /> {loggingOut ? "Logging out…" : "Log out"}
        </button>
      </div>
    </div>
  );
}

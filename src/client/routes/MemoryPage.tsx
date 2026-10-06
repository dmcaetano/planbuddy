import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Constraint, Hunch, Participant, Taste } from "../api/types";
import { Check, LogOut, MapPin, Pencil, Plus, Save, ShieldCheck, ShieldQuestion, Sparkles, Trash2, X } from "lucide-react";
import CitySearch from "../components/CitySearch";
import { Link, useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { SkeletonList } from "../components/Skeleton";
import TasteQuiz from "../components/TasteQuiz";
import { useAuth } from "../state/AuthContext";
import RelationshipEditor from "../components/RelationshipEditor";
import TimeOffSection from "../components/TimeOffSection";
import { PawPrint, User } from "lucide-react";
import { radiusForScale } from "@shared/scale";

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
  const [editingHunchId, setEditingHunchId] = useState<string | null>(null);
  const [hunchDraft, setHunchDraft] = useState({ text: "", polarity: "love" as "love" | "avoid", participantId: "" });

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
    const refresh = () => { void loadAll().catch(() => undefined); };
    window.addEventListener("planbuddy:memory-changed", refresh);
    return () => window.removeEventListener("planbuddy:memory-changed", refresh);
  }, []);

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

  function beginHunchEdit(hunch: Hunch) {
    setEditingHunchId(hunch.id);
    setHunchDraft({ text: hunch.text, polarity: hunch.polarity, participantId: hunch.participantId ?? "" });
  }

  async function saveHunch(id: string) {
    if (!hunchDraft.text.trim()) return;
    const data = await api.patch<{ hunch: Hunch }>(`/hunches/${id}`, {
      text: hunchDraft.text.trim(),
      polarity: hunchDraft.polarity,
      participantId: hunchDraft.participantId || null,
    });
    setHunches((previous) => previous.map((hunch) => hunch.id === id ? data.hunch : hunch));
    setEditingHunchId(null);
  }

  async function removeHunch(id: string) {
    await api.delete(`/hunches/${id}`);
    setHunches((previous) => previous.filter((hunch) => hunch.id !== id));
    if (editingHunchId === id) setEditingHunchId(null);
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

      {auth.user?.homeBaseLabel && <TravelDistanceCard />}

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
      <div className="card people-card">
        <div className="eyebrow">People &amp; pets</div>
        <div className="stack" style={{ gap: 8 }}>
          {participants.filter((p) => !p.isOwner).length === 0 && (
            <div className="empty-state">Nobody added yet. Tell Buddy "Dani is my wife" or add people during onboarding.</div>
          )}
          {participants.filter((p) => !p.isOwner).map((p) => (
            <div className="list-item list-item--plain" key={p.id}>
              <span className="row">{p.kind === "pet" ? <PawPrint size={16} /> : <User size={16} />} <strong>{p.name}</strong></span>
              <RelationshipEditor
                participant={p}
                onSaved={(updated) => setParticipants((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              />
            </div>
          ))}
        </div>
      </div>

      <TimeOffSection />

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
                  {editingHunchId === h.id ? (
                    <div className="stack" style={{ gap: 8 }}>
                      <input aria-label="Hunch text" value={hunchDraft.text} onChange={(event) => setHunchDraft((draft) => ({ ...draft, text: event.target.value }))} />
                      <div className="row-gap">
                        <select className="select" aria-label="Hunch polarity" value={hunchDraft.polarity} onChange={(event) => setHunchDraft((draft) => ({ ...draft, polarity: event.target.value as "love" | "avoid" }))}>
                          <option value="love">Maybe loves</option>
                          <option value="avoid">Maybe avoids</option>
                        </select>
                        <select className="select" aria-label="Hunch person" value={hunchDraft.participantId} onChange={(event) => setHunchDraft((draft) => ({ ...draft, participantId: event.target.value }))}>
                          <option value="">Household</option>
                          {participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
                        </select>
                      </div>
                    </div>
                  ) : <strong>{h.text}</strong>}
                  <p className="muted">Never appears in rationales; contributes at most ±0.15 to fit; decays without reinforcement.</p>
                </div>
                <div className="row-gap">
                  {editingHunchId === h.id ? (
                    <>
                      <button className="icon-btn" title="Save changes" onClick={() => saveHunch(h.id)}><Save size={18} /></button>
                      <button className="icon-btn" title="Cancel editing" onClick={() => setEditingHunchId(null)}><X size={18} /></button>
                    </>
                  ) : (
                    <button className="icon-btn" title="Edit" onClick={() => beginHunchEdit(h)}><Pencil size={18} /></button>
                  )}
                  {h.status === "active" && editingHunchId !== h.id && (
                    <>
                    <button className="icon-btn" title="Confirm" onClick={() => actOnHunch(h.id, "confirm")}>
                      <Check size={18} />
                    </button>
                    <button className="icon-btn" title="Dismiss" onClick={() => actOnHunch(h.id, "dismiss")}>
                      <X size={18} />
                    </button>
                    </>
                  )}
                  {h.status !== "active" && editingHunchId !== h.id && <span className="badge badge-sky">{h.status}</span>}
                  <button className="icon-btn" title="Delete permanently" onClick={() => removeHunch(h.id)}><Trash2 size={18} /></button>
                </div>
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

function TravelDistanceCard() {
  const auth = useAuth();
  const [day, setDay] = useState(radiusForScale("day_off", auth.user));
  const [weekend, setWeekend] = useState(radiusForScale("weekend", auth.user));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedDay = radiusForScale("day_off", auth.user);
  const savedWeekend = radiusForScale("weekend", auth.user);
  const dirty = day !== savedDay || weekend !== savedWeekend;

  useEffect(() => {
    setDay(savedDay);
    setWeekend(savedWeekend);
  }, [savedDay, savedWeekend]);

  async function save() {
    setError(null);
    try {
      const data = await api.put<{ user: NonNullable<typeof auth.user> }>("/auth/travel-preferences", { travelDayKm: day, travelWeekendKm: weekend });
      if (data.user) auth.setUser(data.user);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save how far you will go.");
    }
  }

  return (
    <div className="card travel-distance-card">
      <div className="eyebrow">How far from home</div>
      <p className="muted" style={{ marginTop: 4 }}>Plans stay inside these distances. Closer places are preferred.</p>
      <div className="field-label-row"><label htmlFor="travel-day">Dinner or a day out</label><strong>{day} km</strong></div>
      <input id="travel-day" type="range" min={3} max={100} step={1} value={day} onChange={(event) => { setDay(Number(event.target.value)); setSaved(false); }} />
      <div className="field-label-row"><label htmlFor="travel-weekend">A weekend</label><strong>{weekend} km</strong></div>
      <input id="travel-weekend" type="range" min={10} max={200} step={5} value={weekend} onChange={(event) => { setWeekend(Number(event.target.value)); setSaved(false); }} />
      {error && <div className="error-banner">{error}</div>}
      <button type="button" className="btn btn-sm mt-2" disabled={!dirty} onClick={() => void save()}>{saved && !dirty ? "Saved" : "Save distances"}</button>
    </div>
  );
}

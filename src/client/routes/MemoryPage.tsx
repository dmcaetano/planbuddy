import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Constraint, Hunch, Participant, Taste } from "../api/types";
import { Check, Plus, ShieldCheck, ShieldQuestion, Trash2, X } from "lucide-react";

type Tab = "constraints" | "tastes" | "hunches";

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>("constraints");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [tastes, setTastes] = useState<Taste[]>([]);
  const [hunches, setHunches] = useState<Hunch[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    loadAll().catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load Memory."));
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

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Memory</div>
        <h1>What PlanBuddy knows</h1>
        <p>Every constraint, taste, and hunch is visible and editable — nothing learns silently.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

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
              <select value={cParticipant} onChange={(e) => setCParticipant(e.target.value)} style={{ flex: 1, border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: "8px 10px" }}>
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

          {constraints.length === 0 && <div className="empty-state">No constraints yet.</div>}
          {constraints.map((c) => (
            <div className="card" key={c.id}>
              <div className="list-item" style={{ border: "none", padding: 0 }}>
                <div>
                  <div className="row-gap" style={{ alignItems: "center", marginBottom: 4 }}>
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
              <select value={tParticipant} onChange={(e) => setTParticipant(e.target.value)} style={{ border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: "8px 10px" }}>
                <option value="">Household (everyone)</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={tPolarity} onChange={(e) => setTPolarity(e.target.value as "love" | "avoid")} style={{ border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: "8px 10px" }}>
                <option value="love">Loves</option>
                <option value="avoid">Avoids</option>
              </select>
              <button className="btn btn-primary" onClick={addTaste}>
                <Plus size={16} /> Add
              </button>
            </div>
          </div>

          {tastes.length === 0 && <div className="empty-state">No tastes yet.</div>}
          {tastes.map((t) => (
            <div className="card" key={t.id}>
              <div className="list-item" style={{ border: "none", padding: 0 }}>
                <div>
                  <div className="row-gap" style={{ marginBottom: 4 }}>
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
          {hunches.length === 0 && <div className="empty-state">No hunches yet. They form from feedback and rejections.</div>}
          {hunches.map((h) => (
            <div className="card" key={h.id}>
              <div className="list-item" style={{ border: "none", padding: 0 }}>
                <div>
                  <div className="row-gap" style={{ marginBottom: 4 }}>
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
    </div>
  );
}

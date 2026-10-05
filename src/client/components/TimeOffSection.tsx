import { useEffect, useId, useState } from "react";
import { CalendarDays, Eye, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { TimeOff } from "@shared/momentTypes";
import { formatLocalDate } from "../lib/momentClient";
import ConfirmDialog from "./ConfirmDialog";
import "../styles/timeoff.css";

interface Draft {
  label: string;
  startDate: string;
  endDate: string;
}

const EMPTY: Draft = { label: "", startDate: "", endDate: "" };

function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Memory > Time off: add, edit, delete (with confirmation), and "Show again" for a snoozed range. */
export default function TimeOffSection() {
  const [items, setItems] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<TimeOff | null>(null);
  const uid = useId();
  const today = formatLocalDate(new Date());

  useEffect(() => {
    api
      .get<{ timeOff: TimeOff[] }>("/time-off")
      .then((data) => setItems(data.timeOff))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your time off."))
      .finally(() => setLoading(false));
  }, []);

  function validate(value: Draft): string | null {
    if (!value.label.trim()) return "Give the time off a name, for example Christmas.";
    if (value.label.trim().length > 80) return "Keep the name under 80 characters.";
    if (!value.startDate || !value.endDate) return "Pick a start and an end date.";
    if (value.endDate < value.startDate) return "The end date can't be before the start date.";
    return null;
  }

  async function save() {
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { label: draft.label.trim(), startDate: draft.startDate, endDate: draft.endDate };
      if (editingId) {
        const data = await api.patch<{ timeOff: TimeOff }>(`/time-off/${editingId}`, body);
        setItems((prev) => prev.map((item) => (item.id === editingId ? data.timeOff : item)));
      } else {
        const data = await api.post<{ timeOff: TimeOff }>("/time-off", body);
        setItems((prev) => [...prev, data.timeOff].sort((a, b) => a.startDate.localeCompare(b.startDate)));
      }
      setDraft(EMPTY);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(item: TimeOff) {
    setEditingId(item.id);
    setDraft({ label: item.label, startDate: item.startDate, endDate: item.endDate });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY);
    setError(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/time-off/${deleting.id}`);
      setItems((prev) => prev.filter((item) => item.id !== deleting.id));
      if (editingId === deleting.id) cancelEdit();
      setDeleting(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that. Try again.");
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  async function showAgain(item: TimeOff) {
    setError(null);
    try {
      const data = await api.post<{ timeOff: TimeOff }>(`/time-off/${item.id}/unsnooze`);
      setItems((prev) => prev.map((x) => (x.id === item.id ? data.timeOff : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't do that. Try again.");
    }
  }

  return (
    <section className="card time-off-card" aria-labelledby={`${uid}-title`}>
      <div className="eyebrow" id={`${uid}-title`}><CalendarDays size={13} aria-hidden="true" /> Time off</div>
      {loading ? (
        <p className="muted mb-0">Loading…</p>
      ) : items.length === 0 && !editingId ? (
        <div className="empty-state">No time off yet. Add a range, or tell Buddy "I'm off Dec 24 to 31", and PlanBuddy can suggest a trip.</div>
      ) : (
        <ul className="time-off-list">
          {items.map((item) => {
            const snoozed = Boolean(item.snoozedUntil && item.snoozedUntil >= today);
            return (
              <li key={item.id} className="time-off-item">
                <div className="time-off-item__text">
                  <strong>{item.label}</strong>
                  <span className="muted">{formatDay(item.startDate)} to {formatDay(item.endDate)}</span>
                  {snoozed && <span className="badge badge-honey">Hidden from Home for now</span>}
                </div>
                <div className="time-off-item__actions">
                  {snoozed && (
                    <button type="button" className="btn btn-ghost btn-sm time-off-btn" onClick={() => void showAgain(item)}>
                      <Eye size={14} aria-hidden="true" /> Show again
                    </button>
                  )}
                  <button type="button" className="icon-btn time-off-icon" aria-label={`Edit ${item.label}`} onClick={() => beginEdit(item)}>
                    <Pencil size={18} />
                  </button>
                  <button type="button" className="icon-btn time-off-icon" aria-label={`Delete ${item.label}`} onClick={() => setDeleting(item)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="time-off-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor={`${uid}-label`}>{editingId ? "Edit time off" : "Add time off"}</label>
          <input
            id={`${uid}-label`}
            placeholder="e.g. Christmas break"
            maxLength={80}
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>
        <div className="time-off-dates">
          <div className="field">
            <label htmlFor={`${uid}-start`}>Start date</label>
            <input id={`${uid}-start`} type="date" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-end`}>End date</label>
            <input id={`${uid}-end`} type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
          </div>
        </div>
        {error && <div className="rel-editor__error" role="alert">{error}</div>}
        <div className="row-gap">
          <button type="submit" className="btn btn-primary time-off-btn" disabled={busy}>
            {editingId ? <><Save size={16} aria-hidden="true" /> Save changes</> : <><Plus size={16} aria-hidden="true" /> Add</>}
          </button>
          {editingId && (
            <button type="button" className="btn btn-ghost time-off-btn" onClick={cancelEdit} disabled={busy}>
              <X size={16} aria-hidden="true" /> Cancel
            </button>
          )}
        </div>
      </form>

      {deleting && (
        <ConfirmDialog
          title="Delete this time off?"
          body={`${deleting.label} (${formatDay(deleting.startDate)} to ${formatDay(deleting.endDate)}) will be removed, along with any trip ideas saved for it.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

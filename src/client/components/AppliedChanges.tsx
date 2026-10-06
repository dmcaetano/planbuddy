import { useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { PublicUser } from "../api/types";
import { useAuth } from "../state/AuthContext";

export interface AppliedChange {
  label: string;
  undo: { method: "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown } | null;
}

export const MEMORY_CHANGED_EVENT = "planbuddy:memory-changed";

export function announceAppChange(user: PublicUser | null | undefined, setUser: (user: PublicUser) => void) {
  if (user) setUser(user);
  window.dispatchEvent(new Event(MEMORY_CHANGED_EVENT));
}

export default function AppliedChanges({ changes }: { changes: AppliedChange[] }) {
  const auth = useAuth();
  const [undone, setUndone] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  if (changes.length === 0) return null;

  async function undo(index: number, change: AppliedChange) {
    if (!change.undo) return;
    setError(null);
    try {
      const { method, path, body } = change.undo;
      const result =
        method === "DELETE" ? await api.delete<{ user?: PublicUser }>(path)
        : method === "POST" ? await api.post<{ user?: PublicUser }>(path, body)
        : method === "PUT" ? await api.put<{ user?: PublicUser }>(path, body)
        : await api.patch<{ user?: PublicUser }>(path, body);
      setUndone((current) => ({ ...current, [index]: true }));
      announceAppChange(result?.user, auth.setUser);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not undo that.");
    }
  }

  return (
    <div className="applied-changes" role="status">
      {changes.map((change, index) => (
        <div className="applied-change" key={index}>
          <Check size={14} aria-hidden />
          <span className={undone[index] ? "applied-change__label applied-change__label--undone" : "applied-change__label"}>{change.label}</span>
          {change.undo && !undone[index] && (
            <button type="button" className="applied-change__undo" onClick={() => void undo(index, change)}>
              <Undo2 size={13} /> Undo
            </button>
          )}
          {undone[index] && <span className="applied-change__done">Undone</span>}
        </div>
      ))}
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}

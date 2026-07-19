import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { api, ApiError } from "../api/client";

export default function ShareButton({ candidateId, compact = false }: { candidateId: string; compact?: boolean }) {
  const [status, setStatus] = useState<"idle" | "working" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setStatus("working");
    setError(null);
    try {
      const data = await api.post<{ share: { token: string } }>("/shares", { candidateId });
      const url = `${window.location.origin}/s/${data.share.token}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: "A PlanBuddy plan", text: "Here is the plan", url });
          setStatus("copied");
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            setStatus("idle");
            return;
          }
        }
      }
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "Couldn't create a share link.");
    }
  }

  return (
    <span className="share-control">
      <button className={`btn ${compact ? "btn-ghost btn-sm" : "btn-ghost"}`} onClick={share} disabled={status === "working"}>
        {status === "copied" ? <Check size={16} /> : <Share2 size={16} />}
        {status === "working" ? "Preparing…" : status === "copied" ? "Shared" : "Share"}
      </button>
      {error && <small className="inline-error">{error}</small>}
    </span>
  );
}

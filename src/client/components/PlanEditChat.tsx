import { useEffect, useState } from "react";
import { Bot, Check, Copy, Send, Sparkles, User } from "lucide-react";
import type { Candidate, FeatureSummary, PipelineResponse, PlanChatMessage } from "../api/types";
import { api, ApiError } from "../api/client";
import { useGeneration } from "../state/GenerationContext";

interface ActionResponse {
  userMessage: PlanChatMessage;
  assistantMessage: PlanChatMessage;
  revision: PipelineResponse | null;
  learned: FeatureSummary | null;
  plan: { id: string } | null;
  share: { token: string } | null;
  invite: { token: string } | null;
}

const QUICK_ACTIONS = [
  "Change only the restaurant",
  "Move the meal to dinner",
  "Make it less expensive",
  "Shorten the walking",
];

export default function PlanEditChat({
  threadSpecId,
  candidate,
  onRevision,
  onLocked,
  compact = false,
}: {
  threadSpecId: string;
  candidate: Candidate;
  onRevision: (revision: PipelineResponse) => void;
  onLocked: (planId: string) => void;
  compact?: boolean;
}) {
  const generation = useGeneration();
  const [messages, setMessages] = useState<PlanChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ messages: PlanChatMessage[] }>(`/plan-specs/${threadSpecId}/chat`)
      .then((data) => setMessages(data.messages))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't open the plan chat."));
  }, [threadSpecId]);

  // The completion message is written by the detached job, not the kickoff
  // request. Refresh the durable thread once the shared job settles so the
  // dock tells the same story as the now-updated ticket.
  useEffect(() => {
    if (generation.job?.status !== "succeeded") return;
    api.get<{ messages: PlanChatMessage[] }>(`/plan-specs/${threadSpecId}/chat`)
      .then((data) => setMessages(data.messages))
      .catch(() => undefined);
  }, [generation.job?.jobId, generation.job?.status, threadSpecId]);

  async function send(message = input) {
    const content = message.trim();
    if (!content || working) return;
    setWorking(true);
    setError(null);
    if (message === input) setInput("");
    try {
      const data = await api.post<ActionResponse & { jobId?: string | null; jobSpecId?: string | null; jobKind?: "edit" | "regenerate" | null }>(`/plan-specs/${threadSpecId}/chat-action`, {
        candidateId: candidate.id,
        message: content,
      });
      setMessages((current) => [...current, data.userMessage, data.assistantMessage]);
      if (data.jobId && generation.job?.jobId !== data.jobId) {
        generation.trackJob(data.jobId, data.jobKind === "regenerate" ? "regenerate" : "edit", data.jobSpecId ?? threadSpecId);
      }
      if (data.revision?.winner) onRevision(data.revision);
      if (data.plan?.id) onLocked(data.plan.id);
      const actionUrl = data.share?.token
        ? `${window.location.origin}/s/${data.share.token}`
        : data.invite?.token
          ? `${window.location.origin}/invite/${data.invite.token}`
          : null;
      if (actionUrl) setLinks((current) => ({ ...current, [data.assistantMessage.id]: actionUrl }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Buddy couldn't complete that action.");
    } finally {
      setWorking(false);
    }
  }

  async function copy(messageId: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(messageId);
  }

  return (
    <section className={`plan-chat-card ${compact ? "plan-chat-card--compact" : ""}`}>
      <header className="plan-chat-card__header">
        <div className="buddy-orb"><Bot size={20} /></div>
        <div><div className="eyebrow">Edit with Buddy</div><strong>Ask for one change—or run any plan action.</strong><span>I preserve what you didn't ask me to change.</span></div>
      </header>
      {messages.length === 0 && !working && (
        <div className="plan-chat-intro">
          <p>Try a surgical edit, or say “Love this,” “lock it,” “share it,” “show another,” or “invite a friend.”</p>
          <div className="chip-row">{QUICK_ACTIONS.map((action) => <button className="chip" key={action} onClick={() => void send(action)} disabled={working}>{action}</button>)}</div>
        </div>
      )}
      {(messages.length > 0 || working) && (
        <div className="plan-chat-messages" aria-live="polite">
          {messages.map((message) => (
            <div className={`plan-chat-message plan-chat-message--${message.role}`} key={message.id}>
              <span>{message.role === "assistant" ? <Sparkles size={14} /> : <User size={14} />}</span>
              <div><p>{message.content}</p>{links[message.id] && <button className="chat-link" onClick={() => void copy(message.id, links[message.id])}>{copied === message.id ? <Check size={14} /> : <Copy size={14} />} {copied === message.id ? "Copied" : "Copy private link"}</button>}</div>
            </div>
          ))}
          {working && <div className="plan-chat-message plan-chat-message--assistant"><span><Sparkles size={14} /></span><div><p>Checking the route, constraints, and grounded places…</p></div></div>}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      <form className="plan-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Change the restaurant, make it dinner, lower the cost…" aria-label="Edit this plan with Buddy" />
        <button className="btn btn-primary" type="submit" disabled={working || !input.trim()} aria-label="Send plan edit"><Send size={16} /></button>
      </form>
    </section>
  );
}

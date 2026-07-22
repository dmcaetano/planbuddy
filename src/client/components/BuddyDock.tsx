import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bot, ChevronUp, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { ChatMessage, ChatSession } from "../api/types";
import { useGeneration } from "../state/GenerationContext";
import { usePlanFocus } from "../state/PlanFocusContext";
import PlanEditChat from "./PlanEditChat";

function MemoryBuddyThread() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ session: ChatSession; messages: ChatMessage[] }>("/chat/session")
      .then((data) => { setSession(data.session); setMessages(data.messages); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Buddy couldn't open the conversation."));
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  async function send() {
    const content = input.trim();
    if (!session || !content || sending) return;
    setInput(""); setSending(true); setError(null);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, sessionId: session.id, role: "user", content, createdAt: new Date().toISOString() }]);
    try {
      const data = await api.post<{ userMessage: ChatMessage; assistantMessage: ChatMessage; session: ChatSession }>(`/chat/session/${session.id}/messages`, { content });
      setMessages((current) => [...current.slice(0, -1), data.userMessage, data.assistantMessage]);
      setSession(data.session);
    } catch (err) {
      setMessages((current) => current.filter((message) => !message.id.startsWith("local-")));
      setError(err instanceof ApiError ? err.message : "Buddy couldn't send that. Try again.");
    } finally { setSending(false); }
  }

  return <div className="buddy-thread">
    <p className="buddy-thread__intro">Tell me what you love, what must work, or what feels off. I’ll keep durable facts visible in Memory.</p>
    <div className="buddy-thread__messages" aria-live="polite">
      {messages.length === 0 && <div className="buddy-empty">Try “we want quieter weekends” or “my Pom comes with us.”</div>}
      {messages.map((message) => <div className={`buddy-message buddy-message--${message.role}`} key={message.id}>{message.content}</div>)}
      {sending && <div className="buddy-message buddy-message--assistant"><Sparkles size={14} /> Thinking with your memory…</div>}
      <div ref={bottomRef} />
    </div>
    {error && <div className="error-banner">{error}</div>}
    <form className="buddy-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Talk to Buddy…" aria-label="Talk to Buddy" />
      <button className="btn btn-primary" type="submit" disabled={!input.trim() || sending} aria-label="Send message"><Send size={16} /></button>
    </form>
  </div>;
}

export default function BuddyDock() {
  const [open, setOpen] = useState(false);
  const { focusedPlan } = usePlanFocus();
  const generation = useGeneration();
  const location = useLocation();
  const navigate = useNavigate();
  const activeJob = generation.job && (generation.job.status === "queued" || generation.job.status === "running") ? generation.job : null;
  const completedElsewhere = generation.job?.status === "succeeded" && location.pathname !== "/plan";

  return <aside className={`buddy-dock ${open ? "buddy-dock--open" : ""}`} aria-label="PlanBuddy assistant">
    {open && <section className="buddy-panel" aria-label="Buddy conversation">
      <header className="buddy-panel__header">
        <div className="buddy-panel__identity"><span className="buddy-orb"><Bot size={19} /></span><div><strong>Buddy</strong><span>{focusedPlan ? "Editing this plan" : "Your planning partner"}</span></div></div>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close Buddy"><X size={18} /></button>
      </header>
      {activeJob && <button type="button" className="buddy-job-status" onClick={() => navigate("/plan")}>
        <span className="buddy-job-status__ring" style={{ "--progress": `${Math.max(4, activeJob.progressPct)}%` } as React.CSSProperties} />
        <span><strong>{activeJob.stageDetail || activeJob.stageLabel || "Building your plan"}</strong><small>{Math.round(activeJob.progressPct)}% · keeps working while you browse</small></span>
      </button>}
      {completedElsewhere && <button type="button" className="buddy-job-status buddy-job-status--ready" onClick={() => navigate("/plan")}><Sparkles size={17} /><span><strong>Your plan is ready</strong><small>Open it to see the change.</small></span></button>}
      {focusedPlan ? <PlanEditChat compact threadSpecId={focusedPlan.specId} candidate={focusedPlan.candidate} onRevision={() => undefined} onLocked={(planId) => window.dispatchEvent(new CustomEvent("planbuddy:locked", { detail: { planId } }))} /> : <MemoryBuddyThread />}
      <Link className="buddy-panel__full-chat" to="/chat" onClick={() => setOpen(false)}><MessageCircle size={15} /> Open full chat</Link>
    </section>}
    <button type="button" className={`buddy-fab ${activeJob ? "buddy-fab--working" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "Close Buddy" : activeJob ? "Open Buddy, plan is working" : "Open Buddy"}>
      {open ? <ChevronUp size={23} /> : <Bot size={23} />}
      {activeJob && <span className="buddy-fab__progress">{Math.round(activeJob.progressPct)}%</span>}
    </button>
  </aside>;
}

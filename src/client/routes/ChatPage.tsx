import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { ChatMessage, ChatSession } from "../api/types";
import { Send } from "lucide-react";

interface MemoryUpdate {
  kind: "constraint" | "taste" | "hunch";
  text: string;
  verified: boolean;
}

export default function ChatPage() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdates, setLastUpdates] = useState<MemoryUpdate[]>([]);
  const [specUpdate, setSpecUpdate] = useState<{ scale: string | null; moodContext: string | null } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ session: ChatSession; messages: ChatMessage[] }>("/chat/session").then((d) => {
      setSession(d.session);
      setMessages(d.messages);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!session || !input.trim() || sending) return;
    setError(null);
    setSending(true);
    const content = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, sessionId: session.id, role: "user", content, createdAt: new Date().toISOString() },
    ]);
    try {
      const data = await api.post<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        memoryUpdates: MemoryUpdate[];
        specUpdate: { scale: string | null; moodContext: string | null } | null;
        session: ChatSession;
      }>(`/chat/session/${session.id}/messages`, { content });
      setMessages((prev) => [...prev.slice(0, -1), data.userMessage, data.assistantMessage]);
      setLastUpdates(data.memoryUpdates);
      setSpecUpdate(data.specUpdate);
      setSession(data.session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Message didn't send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function startNewSession() {
    if (session) await api.post("/chat/session/end");
    const d = await api.get<{ session: ChatSession; messages: ChatMessage[] }>("/chat/session");
    setSession(d.session);
    setMessages(d.messages);
    setLastUpdates([]);
    setSpecUpdate(null);
  }

  return (
    <div className="stack" style={{ minHeight: "70vh", display: "flex", flexDirection: "column" }}>
      <div>
        <div className="eyebrow">Chat</div>
        <h1>Talk it through</h1>
        <p>Mention a household constraint or a taste directly and PlanBuddy will remember it, with the exact quote to prove it.</p>
      </div>

      {session?.status === "ended" && (
        <div className="hint-banner">
          This chat session ended.{" "}
          <button className="btn btn-ghost btn-sm" onClick={startNewSession}>
            Start a new one
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 320 }}>
        <div className="stack" style={{ flex: 1, overflowY: "auto" }}>
          {messages.length === 0 && (
            <p className="muted">
              Try: "We're allergic to peanuts" or "We love hiking" — PlanBuddy will protect or personalize immediately.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? "var(--clay-soft)" : "var(--pine-soft)",
                borderRadius: 12,
                padding: "8px 12px",
                maxWidth: "85%",
              }}
            >
              {m.content}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {lastUpdates.length > 0 && (
          <div className="hint-banner" style={{ marginTop: 12 }}>
            {lastUpdates.map((u, i) => (
              <div key={i}>
                {u.verified
                  ? `Added to Memory as a${u.kind === "constraint" ? " constraint" : " taste"}: "${u.text}"`
                  : `Couldn't verify that quote — saved as a soft hunch instead: "${u.text}"`}
              </div>
            ))}
          </div>
        )}

        {specUpdate?.moodContext && (
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => navigate("/plan")}>
            Use this in Plan
          </button>
        )}

        <div className="row-gap" style={{ marginTop: 12 }}>
          <input
            style={{ flex: 1, border: "1px solid var(--hairline-strong)", borderRadius: 10, padding: "10px 12px" }}
            value={input}
            disabled={session?.status === "ended"}
            placeholder="Say something…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn btn-primary" onClick={send} disabled={sending || session?.status === "ended"}>
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

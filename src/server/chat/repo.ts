import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { ChatMessage, ChatRole, ChatSession, ChatSessionStatus } from "../../shared/types.js";

export const MAX_MESSAGES_PER_SESSION = 40;

interface SessionRow {
  id: string;
  user_id: string;
  status: ChatSessionStatus;
  created_at: string;
  ended_at: string | null;
  message_count: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

function sessionToDomain(row: SessionRow): ChatSession {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    messageCount: row.message_count,
  };
}

function messageToDomain(row: MessageRow): ChatMessage {
  return { id: row.id, sessionId: row.session_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export async function getOpenSession(userId: string): Promise<ChatSession | null> {
  const db = await getDb();
  const { rows } = await db.query<SessionRow>(
    "SELECT * FROM chat_sessions WHERE user_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  return rows[0] ? sessionToDomain(rows[0]) : null;
}

export async function createSession(userId: string): Promise<ChatSession> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<SessionRow>(
    `INSERT INTO chat_sessions (id, user_id, status) VALUES ($1, $2, 'open') RETURNING *`,
    [id, userId]
  );
  return sessionToDomain(rows[0]);
}

export async function getOrCreateOpenSession(userId: string): Promise<ChatSession> {
  const existing = await getOpenSession(userId);
  if (existing) return existing;
  return createSession(userId);
}

export async function getSession(userId: string, id: string): Promise<ChatSession | null> {
  const db = await getDb();
  const { rows } = await db.query<SessionRow>("SELECT * FROM chat_sessions WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  return rows[0] ? sessionToDomain(rows[0]) : null;
}

export async function endSession(userId: string, id: string): Promise<ChatSession | null> {
  const db = await getDb();
  const { rows } = await db.query<SessionRow>(
    `UPDATE chat_sessions SET status = 'ended', ended_at = now() WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id]
  );
  return rows[0] ? sessionToDomain(rows[0]) : null;
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const { rows } = await db.query<MessageRow>(
    "SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC",
    [sessionId]
  );
  return rows.map(messageToDomain);
}

export async function addMessage(sessionId: string, role: ChatRole, content: string): Promise<ChatMessage> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<MessageRow>(
    `INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, sessionId, role, content]
  );
  await db.query("UPDATE chat_sessions SET message_count = message_count + 1 WHERE id = $1", [sessionId]);
  return messageToDomain(rows[0]);
}

import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { stringifyJsonForDb } from "../db/json.js";
import type { PlanChatMessage } from "../../shared/types.js";

interface PlanChatRow {
  id: string;
  user_id: string;
  plan_spec_id: string;
  candidate_id: string | null;
  role: "user" | "assistant";
  content: string;
  action: Record<string, unknown> | null;
  created_at: string;
}

function toDomain(row: PlanChatRow): PlanChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    planSpecId: row.plan_spec_id,
    candidateId: row.candidate_id,
    role: row.role,
    content: row.content,
    action: row.action,
    createdAt: row.created_at,
  };
}

export async function listPlanChatMessages(userId: string, planSpecId: string): Promise<PlanChatMessage[]> {
  const db = await getDb();
  const { rows } = await db.query<PlanChatRow>(
    `SELECT * FROM plan_chat_messages
     WHERE user_id = $1 AND plan_spec_id = $2
     ORDER BY created_at ASC`,
    [userId, planSpecId]
  );
  return rows.map(toDomain);
}

export async function addPlanChatMessage(
  userId: string,
  planSpecId: string,
  candidateId: string | null,
  role: "user" | "assistant",
  content: string,
  action?: Record<string, unknown> | null
): Promise<PlanChatMessage> {
  const db = await getDb();
  const { rows } = await db.query<PlanChatRow>(
    `INSERT INTO plan_chat_messages (id, user_id, plan_spec_id, candidate_id, role, content, action)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [newId(), userId, planSpecId, candidateId, role, content, action ? stringifyJsonForDb(action) : null]
  );
  return toDomain(rows[0]);
}

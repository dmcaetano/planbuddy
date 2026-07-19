import { getDb } from "../db/client.js";
import { logger } from "../logger.js";

const RETENTION_DAYS = 30;

/**
 * Raw chat transcripts are not durable ranking memory (only structured
 * constraints/tastes/hunches are). Ended sessions' messages are purged 30
 * days after the session ends.
 */
export async function sweepExpiredChatMessages(): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM chat_messages
     WHERE session_id IN (
       SELECT id FROM chat_sessions WHERE status = 'ended' AND ended_at < now() - interval '${RETENTION_DAYS} days'
     )
     RETURNING id`
  );
  if (rows.length > 0) {
    logger.info(`Chat retention sweep deleted ${rows.length} expired message(s)`);
  }
  return rows.length;
}

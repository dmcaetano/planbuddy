import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { Hunch, HunchEvidence, HunchStatus, TastePolarity } from "../../shared/types.js";
import { createTaste } from "./tastes.repo.js";

const DECAY_DAYS = 90;
const DECAY_PLAN_COUNT = 6;
const PROMOTION_EVIDENCE_THRESHOLD = 3;
export const HUNCH_MAX_CONTRIBUTION = 0.15;

interface HunchRow {
  id: string;
  user_id: string;
  participant_id: string | null;
  text: string;
  polarity: TastePolarity;
  confidence: number;
  evidence_count: number;
  plans_since_evidence: number;
  last_evidence_at: string | null;
  decay_at: string;
  status: HunchStatus;
  created_at: string;
  updated_at: string;
}

function toDomain(row: HunchRow): Hunch {
  return {
    id: row.id,
    userId: row.user_id,
    participantId: row.participant_id,
    text: row.text,
    polarity: row.polarity,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    plansSinceEvidence: row.plans_since_evidence,
    lastEvidenceAt: row.last_evidence_at,
    decayAt: row.decay_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function decayTimestamp(): string {
  return new Date(Date.now() + DECAY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Expires hunches that have decayed by time or by unreinforced plan count. */
async function applyDecay(userId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE hunches SET status = 'dismissed', updated_at = now()
     WHERE user_id = $1 AND status = 'active'
       AND (decay_at < now() OR plans_since_evidence >= $2)`,
    [userId, DECAY_PLAN_COUNT]
  );
}

export async function listHunches(userId: string): Promise<Hunch[]> {
  await applyDecay(userId);
  const db = await getDb();
  const { rows } = await db.query<HunchRow>(
    "SELECT * FROM hunches WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(toDomain);
}

/** Active, non-decayed hunches usable for scoring (clamped ± contribution). */
export async function listActiveHunches(userId: string): Promise<Hunch[]> {
  await applyDecay(userId);
  const db = await getDb();
  const { rows } = await db.query<HunchRow>(
    "SELECT * FROM hunches WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(toDomain);
}

export async function getHunch(userId: string, id: string): Promise<Hunch | null> {
  const db = await getDb();
  const { rows } = await db.query<HunchRow>("SELECT * FROM hunches WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  return rows[0] ? toDomain(rows[0]) : null;
}

async function getEvidenceOriginCount(hunchId: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ origin: string }>(
    `SELECT DISTINCT COALESCE(plan_id, session_id, id) AS origin
     FROM hunch_evidence WHERE hunch_id = $1`,
    [hunchId]
  );
  return rows.length;
}

/**
 * Records one explicit evidence event for a participant/text/polarity signal.
 * Creates the hunch if it doesn't exist yet; reinforces and resets decay if
 * it does. Promotes to a taste (never to a constraint) once evidence spans
 * three distinct plans/sessions, per the product contract.
 */
export async function recordHunchEvidence(
  userId: string,
  input: {
    participantId: string | null;
    text: string;
    polarity: TastePolarity;
    planId?: string | null;
    sessionId?: string | null;
    note: string;
  }
): Promise<Hunch> {
  const db = await getDb();
  const normalized = normalize(input.text);
  const { rows: matches } = await db.query<HunchRow>(
    `SELECT * FROM hunches
     WHERE user_id = $1 AND status = 'active' AND polarity = $2
       AND lower(text) = $3
       AND COALESCE(participant_id, '') = COALESCE($4, '')`,
    [userId, input.polarity, normalized, input.participantId]
  );

  let hunch: HunchRow;
  if (matches[0]) {
    hunch = matches[0];
    if (input.planId || input.sessionId) {
      const { rows: duplicateOrigins } = await db.query<{ id: string }>(
        `SELECT id FROM hunch_evidence
         WHERE hunch_id = $1
           AND (($2::text IS NOT NULL AND plan_id = $2) OR ($3::text IS NOT NULL AND session_id = $3))
         LIMIT 1`,
        [hunch.id, input.planId ?? null, input.sessionId ?? null]
      );
      if (duplicateOrigins[0]) return toDomain(hunch);
    }
    const { rows } = await db.query<HunchRow>(
      `UPDATE hunches
       SET evidence_count = evidence_count + 1,
           plans_since_evidence = 0,
           last_evidence_at = now(),
           confidence = LEAST(1, confidence + 0.2),
           decay_at = $3,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [hunch.id, userId, decayTimestamp()]
    );
    hunch = rows[0];
  } else {
    const id = newId();
    const { rows } = await db.query<HunchRow>(
      `INSERT INTO hunches
        (id, user_id, participant_id, text, polarity, confidence, evidence_count,
         plans_since_evidence, last_evidence_at, decay_at, status)
       VALUES ($1, $2, $3, $4, $5, 0.3, 1, 0, now(), $6, 'active')
       RETURNING *`,
      [id, userId, input.participantId, input.text.trim(), input.polarity, decayTimestamp()]
    );
    hunch = rows[0];
  }

  await db.query(
    `INSERT INTO hunch_evidence (id, hunch_id, plan_id, session_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [newId(), hunch.id, input.planId ?? null, input.sessionId ?? null, input.note]
  );

  const originCount = await getEvidenceOriginCount(hunch.id);
  if (originCount >= PROMOTION_EVIDENCE_THRESHOLD) {
    await createTaste(userId, {
      participantId: hunch.participant_id,
      text: hunch.text,
      polarity: hunch.polarity,
      weight: 0.6,
      source: "promoted",
    });
    const { rows } = await db.query<HunchRow>(
      `UPDATE hunches SET status = 'promoted', updated_at = now() WHERE id = $1 RETURNING *`,
      [hunch.id]
    );
    hunch = rows[0];
  }

  return toDomain(hunch);
}

export async function removeReactionEvidence(userId: string, candidateId: string): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<{ hunch_id: string }>(
    `DELETE FROM hunch_evidence he
     USING hunches h
     WHERE he.hunch_id = h.id
       AND h.user_id = $1
       AND he.session_id = $2
       AND he.note LIKE 'Love:%'
     RETURNING he.hunch_id`,
    [userId, candidateId]
  );
  for (const hunchId of new Set(rows.map((row) => row.hunch_id))) {
    const { rows: counts } = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM hunch_evidence WHERE hunch_id = $1",
      [hunchId]
    );
    const count = Number(counts[0]?.count ?? 0);
    if (count === 0) {
      await db.query("DELETE FROM hunches WHERE id = $1 AND user_id = $2 AND status = 'active'", [hunchId, userId]);
    } else {
      await db.query(
        `UPDATE hunches
         SET evidence_count = $3,
             confidence = GREATEST(0.3, LEAST(1, 0.1 + $3 * 0.2)),
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [hunchId, userId, count]
      );
    }
  }
}

export async function listHunchEvidence(hunchId: string): Promise<HunchEvidence[]> {
  const db = await getDb();
  const { rows } = await db.query<{
    id: string;
    hunch_id: string;
    plan_id: string | null;
    session_id: string | null;
    note: string;
    created_at: string;
  }>("SELECT * FROM hunch_evidence WHERE hunch_id = $1 ORDER BY created_at ASC", [hunchId]);
  return rows.map((r) => ({
    id: r.id,
    hunchId: r.hunch_id,
    planId: r.plan_id,
    sessionId: r.session_id,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export async function dismissHunch(userId: string, id: string): Promise<Hunch | null> {
  const db = await getDb();
  const { rows } = await db.query<HunchRow>(
    `UPDATE hunches SET status = 'dismissed', updated_at = now()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id]
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

/** User-driven confirmation counts as an explicit evidence event. */
export async function confirmHunch(userId: string, id: string): Promise<Hunch | null> {
  const hunch = await getHunch(userId, id);
  if (!hunch || hunch.status !== "active") return hunch;
  return recordHunchEvidence(userId, {
    participantId: hunch.participantId,
    text: hunch.text,
    polarity: hunch.polarity,
    note: "Confirmed by user in Memory",
  });
}

/** Called once per plan generation to age out hunches with no reinforcement. */
export async function bumpPlansSinceEvidence(userId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE hunches SET plans_since_evidence = plans_since_evidence + 1, updated_at = now()
     WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  await applyDecay(userId);
}

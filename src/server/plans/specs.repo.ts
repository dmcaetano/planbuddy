import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { toDateOnlyString } from "../db/dateUtil.js";
import type { PlanSpec } from "../../shared/types.js";
import { SCALE_RADIUS_KM, type Scale } from "../../shared/scale.js";

interface SpecRow {
  id: string;
  user_id: string;
  parent_spec_id: string | null;
  version: number;
  scale: Scale;
  start_date: string;
  end_date: string;
  radius_km: number;
  mood_context: string | null;
  generation_count: number;
  created_at: string;
}

async function attachParticipants(spec: SpecRow): Promise<PlanSpec> {
  const db = await getDb();
  const { rows } = await db.query<{ participant_id: string }>(
    "SELECT participant_id FROM spec_participants WHERE plan_spec_id = $1",
    [spec.id]
  );
  return {
    id: spec.id,
    userId: spec.user_id,
    parentSpecId: spec.parent_spec_id,
    version: spec.version,
    scale: spec.scale,
    startDate: toDateOnlyString(spec.start_date),
    endDate: toDateOnlyString(spec.end_date),
    radiusKm: spec.radius_km,
    moodContext: spec.mood_context,
    generationCount: spec.generation_count,
    participantIds: rows.map((r) => r.participant_id),
    createdAt: spec.created_at,
  };
}

export async function createPlanSpec(
  userId: string,
  input: {
    scale: Scale;
    startDate: string;
    endDate: string;
    radiusKm?: number;
    moodContext?: string | null;
    participantIds: string[];
    parentSpecId?: string | null;
    version?: number;
  }
): Promise<PlanSpec> {
  const db = await getDb();
  const id = newId();
  const radiusKm = input.radiusKm ?? SCALE_RADIUS_KM[input.scale];
  const { rows } = await db.query<SpecRow>(
    `INSERT INTO plan_specs (id, user_id, parent_spec_id, version, scale, start_date, end_date, radius_km, mood_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      userId,
      input.parentSpecId ?? null,
      input.version ?? 1,
      input.scale,
      input.startDate,
      input.endDate,
      radiusKm,
      input.moodContext ?? null,
    ]
  );
  for (const participantId of input.participantIds) {
    await db.query("INSERT INTO spec_participants (plan_spec_id, participant_id) VALUES ($1, $2)", [
      id,
      participantId,
    ]);
  }
  return attachParticipants(rows[0]);
}

export async function getPlanSpec(userId: string, id: string): Promise<PlanSpec | null> {
  const db = await getDb();
  const { rows } = await db.query<SpecRow>("SELECT * FROM plan_specs WHERE user_id = $1 AND id = $2", [
    userId,
    id,
  ]);
  return rows[0] ? attachParticipants(rows[0]) : null;
}

export async function incrementGenerationCount(id: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ generation_count: number }>(
    "UPDATE plan_specs SET generation_count = generation_count + 1 WHERE id = $1 RETURNING generation_count",
    [id]
  );
  return rows[0]?.generation_count ?? 0;
}

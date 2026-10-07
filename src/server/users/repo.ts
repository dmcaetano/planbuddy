import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import type { PublicUser } from "../../shared/types.js";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  home_base_label: string | null;
  home_base_lat: number | null;
  home_base_lng: number | null;
  travel_day_km: number | null;
  travel_weekend_km: number | null;
  created_at: string;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    homeBaseLabel: row.home_base_label,
    homeBaseLat: row.home_base_lat,
    homeBaseLng: row.home_base_lng,
    travelDayKm: row.travel_day_km,
    travelWeekendKm: row.travel_weekend_km,
    createdAt: row.created_at,
  };
}

export async function createUser(email: string, passwordHash: string): Promise<PublicUser> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email, password_hash, home_base_label, home_base_lat, home_base_lng, travel_day_km, travel_weekend_km, created_at`,
    [id, email, passwordHash]
  );
  return toPublic(rows[0]);
}

export async function getUserByEmail(
  email: string
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>(
    `SELECT id, email, password_hash, home_base_label, home_base_lat, home_base_lng, travel_day_km, travel_weekend_km, created_at
     FROM users WHERE email = $1`,
    [email]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toPublic(row), passwordHash: row.password_hash };
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>(
    `SELECT id, email, password_hash, home_base_label, home_base_lat, home_base_lng, travel_day_km, travel_weekend_km, created_at
     FROM users WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? toPublic(row) : null;
}

export async function setHomeBase(
  userId: string,
  label: string,
  lat: number,
  lng: number
): Promise<PublicUser> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET home_base_label = $2, home_base_lat = $3, home_base_lng = $4
     WHERE id = $1
     RETURNING id, email, password_hash, home_base_label, home_base_lat, home_base_lng, travel_day_km, travel_weekend_km, created_at`,
    [userId, label, lat, lng]
  );
  return toPublic(rows[0]);
}

export async function setTravelPreferences(userId: string, travelDayKm: number, travelWeekendKm: number): Promise<PublicUser> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET travel_day_km = $2, travel_weekend_km = $3
     WHERE id = $1
     RETURNING id, email, password_hash, home_base_label, home_base_lat, home_base_lng, travel_day_km, travel_weekend_km, created_at`,
    [userId, travelDayKm, travelWeekendKm]
  );
  return toPublic(rows[0]);
}

/** Account lookup for the hub connect flow: id plus whether the hub (not self-signup) vouched for the email. */
export async function getUserForConnect(email: string): Promise<{ id: string; hubVerified: boolean } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string; hub_verified: boolean }>("SELECT id, hub_verified FROM users WHERE email = $1", [email]);
  return rows[0] ? { id: rows[0].id, hubVerified: rows[0].hub_verified } : null;
}

/** Creates a hub-verified account. Returns null when the email was taken meanwhile (unique violation). */
export async function createHubVerifiedUser(email: string, passwordHash: string): Promise<string | null> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO users (id, email, password_hash, hub_verified) VALUES ($1,$2,$3,true) ON CONFLICT (email) DO NOTHING RETURNING id",
    [id, email, passwordHash]
  );
  return rows[0]?.id ?? null;
}

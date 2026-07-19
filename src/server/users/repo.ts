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
  created_at: string;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    homeBaseLabel: row.home_base_label,
    homeBaseLat: row.home_base_lat,
    homeBaseLng: row.home_base_lng,
    createdAt: row.created_at,
  };
}

export async function createUser(email: string, passwordHash: string): Promise<PublicUser> {
  const db = await getDb();
  const id = newId();
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email, password_hash, home_base_label, home_base_lat, home_base_lng, created_at`,
    [id, email, passwordHash]
  );
  return toPublic(rows[0]);
}

export async function getUserByEmail(
  email: string
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>(
    `SELECT id, email, password_hash, home_base_label, home_base_lat, home_base_lng, created_at
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
    `SELECT id, email, password_hash, home_base_label, home_base_lat, home_base_lng, created_at
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
     RETURNING id, email, password_hash, home_base_label, home_base_lat, home_base_lng, created_at`,
    [userId, label, lat, lng]
  );
  return toPublic(rows[0]);
}

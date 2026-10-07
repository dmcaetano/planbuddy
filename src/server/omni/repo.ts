import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";

export interface OmniLink {
  userId: string;
  linkId: string;
  hubToken: string;
  signingKey: string;
  hubUrl: string;
}

interface LinkRow {
  user_id: string;
  link_id: string;
  hub_token: string;
  signing_key: string;
  hub_url: string;
}
const toLink = (r: LinkRow): OmniLink => ({ userId: r.user_id, linkId: r.link_id, hubToken: r.hub_token, signingKey: r.signing_key, hubUrl: r.hub_url });

export async function getLinkById(linkId: string): Promise<OmniLink | null> {
  const db = await getDb();
  const { rows } = await db.query<LinkRow>("SELECT * FROM omni_links WHERE link_id = $1", [linkId]);
  return rows[0] ? toLink(rows[0]) : null;
}

export async function getLinkForUser(userId: string): Promise<OmniLink | null> {
  const db = await getDb();
  const { rows } = await db.query<LinkRow>("SELECT * FROM omni_links WHERE user_id = $1", [userId]);
  return rows[0] ? toLink(rows[0]) : null;
}

export async function saveLink(l: OmniLink): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO omni_links (user_id, link_id, hub_token, signing_key, hub_url) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE SET link_id = EXCLUDED.link_id, hub_token = EXCLUDED.hub_token,
       signing_key = EXCLUDED.signing_key, hub_url = EXCLUDED.hub_url, created_at = now()`,
    [l.userId, l.linkId, l.hubToken, l.signingKey, l.hubUrl]
  );
  await db.query("DELETE FROM omni_pushed WHERE user_id = $1", [l.userId]);
}

export async function deleteLink(userId: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM omni_links WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM omni_pushed WHERE user_id = $1", [userId]);
}

export async function createUndo(userId: string, kind: string, payload: unknown): Promise<string> {
  const db = await getDb();
  const token = "u-" + newId().replace(/-/g, "");
  await db.query("INSERT INTO omni_undo (token, user_id, kind, payload) VALUES ($1,$2,$3,$4)", [token, userId, kind, JSON.stringify(payload)]);
  return token;
}

/** Atomically claims an unused undo token for this user; null when unknown, foreign or already used. */
export async function claimUndo(userId: string, token: string): Promise<{ kind: string; payload: Record<string, unknown> } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ kind: string; payload: string }>(
    `UPDATE omni_undo SET used_at = now() WHERE token = $1 AND user_id = $2 AND used_at IS NULL RETURNING kind, payload`,
    [token, userId]
  );
  if (!rows[0]) return null;
  return { kind: rows[0].kind, payload: JSON.parse(rows[0].payload) };
}

export async function pushedDigests(userId: string): Promise<Map<string, string>> {
  const db = await getDb();
  const { rows } = await db.query<{ origin_item_id: string; digest: string }>("SELECT origin_item_id, digest FROM omni_pushed WHERE user_id = $1", [userId]);
  return new Map(rows.map((r) => [r.origin_item_id, r.digest]));
}

export async function markPushed(userId: string, id: string, digest: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO omni_pushed (user_id, origin_item_id, digest) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, origin_item_id) DO UPDATE SET digest = EXCLUDED.digest, pushed_at = now()`,
    [userId, id, digest]
  );
}

export async function unmarkPushed(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM omni_pushed WHERE user_id = $1 AND origin_item_id = $2", [userId, id]);
}

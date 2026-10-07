import crypto from "node:crypto";
import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { env } from "../env.js";

// Link secrets (hub token, signing key) are encrypted at rest with AES-256-GCM under a key derived from
// SESSION_SECRET. The signing key must be recoverable (it is an HMAC key), so it cannot be a one-way hash.
const ENC_PREFIX = "enc:v1:";
const encKey = () => Buffer.from(crypto.hkdfSync("sha256", env.SESSION_SECRET, "planbuddy-omni", "omni-link-secrets", 32));

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/** Reads a sealed secret; a legacy plaintext row (pre-1.6.1) is returned as is and re-sealed on the next write. */
export function openSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

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
const toLink = (r: LinkRow): OmniLink => ({ userId: r.user_id, linkId: r.link_id, hubToken: openSecret(r.hub_token), signingKey: openSecret(r.signing_key), hubUrl: r.hub_url });

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
    [l.userId, l.linkId, sealSecret(l.hubToken), sealSecret(l.signingKey), l.hubUrl]
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

/** Re-seals any legacy plaintext link secrets. Idempotent; run once at startup. */
export async function sealLegacyLinks(): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<LinkRow>("SELECT * FROM omni_links WHERE hub_token NOT LIKE 'enc:v1:%' OR signing_key NOT LIKE 'enc:v1:%'");
  for (const r of rows) {
    await db.query("UPDATE omni_links SET hub_token = $2, signing_key = $3 WHERE user_id = $1", [r.user_id, sealSecret(openSecret(r.hub_token)), sealSecret(openSecret(r.signing_key))]);
  }
}

/** Remembers a signature until `ttlMs` has passed. Returns false when it was already seen (a replay). */
export async function claimSignature(linkId: string, signature: string, expiresAtMs: number): Promise<boolean> {
  const db = await getDb();
  // one statement: the primary key makes insert-or-reject atomic, so two concurrent copies cannot both win
  const { rows } = await db.query(
    `INSERT INTO omni_seen (signature, link_id, expires_at) VALUES ($1,$2, to_timestamp($3 / 1000.0))
     ON CONFLICT (signature) DO NOTHING RETURNING signature`,
    [signature, linkId, expiresAtMs]
  );
  // housekeeping is separate and best-effort; it can never un-reject a replay because only expired rows go
  void db.query("DELETE FROM omni_seen WHERE expires_at < now()").catch(() => undefined);
  return rows.length > 0;
}

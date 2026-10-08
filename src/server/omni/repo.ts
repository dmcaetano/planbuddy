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
export async function claimSignature(linkId: string, signature: string, nowMs: number, maxSkewMs: number): Promise<boolean> {
  const db = await getDb();
  // ONE clock (this server's, the same instant that validated the timestamp). A timestamp is accepted while it is
  // within +/- maxSkewMs of nowMs, so the latest moment it could still pass is nowMs + 2*maxSkewMs; the row is kept
  // past that plus a margin, so it can never expire while its timestamp is still acceptable.
  const expiresAtMs = nowMs + 2 * maxSkewMs + 60_000;
  // one statement: the primary key makes insert-or-reject atomic, so two concurrent copies cannot both win
  const { rows } = await db.query(
    `INSERT INTO omni_seen (signature, link_id, expires_at) VALUES ($1,$2, to_timestamp($3 / 1000.0))
     ON CONFLICT (signature) DO NOTHING RETURNING signature`,
    [signature, linkId, expiresAtMs]
  );
  // housekeeping uses the same app clock (never the DB's now()); only rows already past their expiry go
  void db.query("DELETE FROM omni_seen WHERE expires_at < to_timestamp($1 / 1000.0)", [nowMs]).catch(() => undefined);
  return rows.length > 0;
}

export const BAD_SIG_MAX_ROWS = 20_000;
const SWEEP_EVERY_WRITES = 500;
const SWEEP_EVERY_MS = 30_000;
let writesSinceSweep = 0;
let lastSweepAt = 0;

/** Bounds omni_bad_sig: drops expired windows, then evicts oldest-first beyond `maxRows`. One row per IP, never per request. */
export async function sweepBadSignatures(nowMs: number, windowMs: number, maxRows = BAD_SIG_MAX_ROWS): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM omni_bad_sig WHERE window_start < $1", [nowMs - windowMs]);
  await db.query(
    `DELETE FROM omni_bad_sig WHERE ip IN (
       SELECT ip FROM omni_bad_sig ORDER BY window_start DESC OFFSET $1
     )`,
    // OFFSET keeps the newest maxRows rows; everything older is evicted
    [maxRows]
  );
}

/**
 * Atomically counts one failed signed request for a source IP (upsert: one row per IP); returns the count inside the
 * current window. The table is kept bounded by a periodic sweep (every 500 writes or 30 s), so rotating source IPs
 * cannot grow it without limit.
 */
export const CONNECT_LOGIN_FAIL_MAX_ROWS = 20_000;
let loginFailWritesSinceSweep = 0;
let loginFailLastSweepAt = 0;

/** Bounds omni_connect_login_fail the same way sweepBadSignatures bounds omni_bad_sig: drop expired windows, then evict oldest-first. */
export async function sweepConnectLoginFailures(nowMs: number, windowMs: number, maxRows = CONNECT_LOGIN_FAIL_MAX_ROWS): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM omni_connect_login_fail WHERE window_start < $1", [nowMs - windowMs]);
  await db.query(
    `DELETE FROM omni_connect_login_fail WHERE email IN (
       SELECT email FROM omni_connect_login_fail ORDER BY window_start DESC OFFSET $1
     )`,
    [maxRows]
  );
}

/** Failed-attempt count for a login.email within the current window, without recording anything (peek only). */
export async function getConnectLoginFailures(email: string, nowMs: number, windowMs: number): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ window_start: string; n: number }>("SELECT window_start, n FROM omni_connect_login_fail WHERE email = $1", [email]);
  const row = rows[0];
  if (!row || Number(row.window_start) < nowMs - windowMs) return 0;
  return Number(row.n);
}

/** Atomically records one failed connect-with-login attempt for this email (upsert: one row per email); returns the new count. */
export async function recordConnectLoginFailure(email: string, nowMs: number, windowMs: number): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO omni_connect_login_fail (email, window_start, n) VALUES ($1,$2,1)
     ON CONFLICT (email) DO UPDATE SET
       n = CASE WHEN omni_connect_login_fail.window_start < $2 - $3 THEN 1 ELSE omni_connect_login_fail.n + 1 END,
       window_start = CASE WHEN omni_connect_login_fail.window_start < $2 - $3 THEN $2 ELSE omni_connect_login_fail.window_start END
     RETURNING n`,
    [email, nowMs, windowMs]
  );
  loginFailWritesSinceSweep++;
  if (loginFailWritesSinceSweep >= SWEEP_EVERY_WRITES || nowMs - loginFailLastSweepAt >= SWEEP_EVERY_MS) {
    loginFailWritesSinceSweep = 0;
    loginFailLastSweepAt = nowMs;
    void sweepConnectLoginFailures(nowMs, windowMs).catch(() => undefined);
  }
  return Number(rows[0]?.n ?? 1);
}

/** Clears the failure counter for an email, e.g. after a successful connect-with-login. */
export async function clearConnectLoginFailures(email: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM omni_connect_login_fail WHERE email = $1", [email]);
}

export async function countBadSignature(ip: string, nowMs: number, windowMs: number): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO omni_bad_sig (ip, window_start, n) VALUES ($1,$2,1)
     ON CONFLICT (ip) DO UPDATE SET
       n = CASE WHEN omni_bad_sig.window_start < $2 - $3 THEN 1 ELSE omni_bad_sig.n + 1 END,
       window_start = CASE WHEN omni_bad_sig.window_start < $2 - $3 THEN $2 ELSE omni_bad_sig.window_start END
     RETURNING n`,
    [ip, nowMs, windowMs]
  );
  writesSinceSweep++;
  if (writesSinceSweep >= SWEEP_EVERY_WRITES || nowMs - lastSweepAt >= SWEEP_EVERY_MS) {
    writesSinceSweep = 0;
    lastSweepAt = nowMs;
    void sweepBadSignatures(nowMs, windowMs).catch(() => undefined);
  }
  return Number(rows[0]?.n ?? 1);
}

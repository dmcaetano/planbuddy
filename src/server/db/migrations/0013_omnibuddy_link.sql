-- Buddy Contract v1 (OmniBuddy hub): the link to the hub, undo tokens, and what was pushed to the hub's shared memory.
-- Additive only. Secrets (hub token, per-link signing key) live in this table, never in git.

CREATE TABLE IF NOT EXISTS omni_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL UNIQUE,
  hub_token TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  hub_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS omni_undo (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS omni_pushed (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_item_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  pushed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, origin_item_id)
);

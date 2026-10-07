-- Buddy Contract v1 replay protection: every accepted signature on a state-changing request is remembered
-- until its skew window has passed, so a captured request cannot be played twice. Additive only.
CREATE TABLE IF NOT EXISTS omni_seen (
  signature TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS omni_seen_expires_idx ON omni_seen (expires_at);

-- DB-backed fixed-window rate limiting for the Cloudflare Worker (2026-10
-- cutover). The Worker has no single long-lived process to hold an
-- in-memory counter across requests (each isolate has its own), so every
-- limiter (auth, AI, public share tokens, Buddy-link) shares one counter
-- table here instead. One row per (bucket, key, window). Swept by the
-- Worker's existing 5-minute cron.
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window_start ON rate_limit (window_start);

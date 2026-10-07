-- Buddy Contract v1: persistent per-source-IP counter of FAILED signed requests (brute-force damper).
-- Shared by every instance and surviving restarts. Additive only.
CREATE TABLE IF NOT EXISTS omni_bad_sig (
  ip TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  n INTEGER NOT NULL
);

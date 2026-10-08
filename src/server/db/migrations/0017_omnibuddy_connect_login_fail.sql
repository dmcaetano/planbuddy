-- Buddy Contract v1.1: persistent per-login-email counter of FAILED connect-with-login attempts.
-- Shared by every instance and surviving restarts. Additive only.
CREATE TABLE IF NOT EXISTS omni_connect_login_fail (
  email TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  n INTEGER NOT NULL
);

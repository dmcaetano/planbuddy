-- Async job tracking for plan generation (create / regenerate / tweak).
-- The pipeline used to run synchronously inside the request handler; it now
-- runs detached and reports stage progress here so clients can poll instead
-- of holding a 20-60s HTTP request open.

CREATE TABLE IF NOT EXISTS plan_generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'regenerate', 'tweak')),
  request_payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')) DEFAULT 'queued',
  stage TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  locked_until TIMESTAMPTZ,
  result JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_generation_jobs_user ON plan_generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_generation_jobs_user_status ON plan_generation_jobs(user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_generation_jobs_idempotency
  ON plan_generation_jobs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
;

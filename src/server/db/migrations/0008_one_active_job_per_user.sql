-- Enforce "one active generation job per user" at the database level. The
-- application-level check-then-insert in enqueueGenerationJob is a TOCTOU
-- race under concurrent requests (two tabs, a double-click, a retry storm);
-- this partial unique index is the actual guarantee, and the app catches the
-- resulting unique-violation to fold the second request onto the first job.

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_generation_jobs_one_active_per_user
  ON plan_generation_jobs(user_id)
  WHERE status IN ('queued', 'running')
;

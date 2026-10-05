-- Max 1-click life: the moment a proposal answers, plus the time-off tables.
-- Every statement is idempotent so a partly applied run can be repeated, and
-- uses only plain Postgres features that PGlite and Neon both support.

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS moment_kind TEXT
;

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS moment_key TEXT
;

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS plan_date DATE
;

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS inputs_fingerprint TEXT
;

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS reason_parts JSONB
;

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS moment_times JSONB
;

CREATE INDEX IF NOT EXISTS idx_plan_specs_user_moment
  ON plan_specs(user_id, moment_key)
;

CREATE TABLE IF NOT EXISTS life_dates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  snoozed_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
)
;

CREATE INDEX IF NOT EXISTS idx_life_dates_user ON life_dates(user_id, start_date)
;

CREATE TABLE IF NOT EXISTS trip_ideas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  life_date_id TEXT NOT NULL REFERENCES life_dates(id) ON DELETE CASCADE,
  taste_fingerprint TEXT NOT NULL,
  ideas JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;

CREATE INDEX IF NOT EXISTS idx_trip_ideas_user_range ON trip_ideas(user_id, life_date_id)

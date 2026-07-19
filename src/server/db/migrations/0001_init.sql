-- PlanBuddy normalized schema.
-- IDs are application-generated UUID v4 strings (no pgcrypto/uuid-ossp
-- dependency), so this file runs unmodified on Neon Postgres and on the
-- embedded local PGlite fallback.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  home_base_label TEXT,
  home_base_lat DOUBLE PRECISION,
  home_base_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'pet')),
  relationship TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);

CREATE TABLE IF NOT EXISTS constraints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'active_unverified')),
  source TEXT NOT NULL CHECK (source IN ('typed', 'chat')),
  source_quote TEXT,
  source_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_constraints_user ON constraints(user_id);
CREATE INDEX IF NOT EXISTS idx_constraints_participant ON constraints(participant_id);

CREATE TABLE IF NOT EXISTS tastes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('love', 'avoid')),
  weight DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL CHECK (source IN ('stated', 'onboarding', 'promoted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tastes_user ON tastes(user_id);
CREATE INDEX IF NOT EXISTS idx_tastes_participant ON tastes(participant_id);

CREATE TABLE IF NOT EXISTS hunches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('love', 'avoid')),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.2,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  plans_since_evidence INTEGER NOT NULL DEFAULT 0,
  last_evidence_at TIMESTAMPTZ,
  decay_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'dismissed', 'promoted')) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hunches_user ON hunches(user_id);
CREATE INDEX IF NOT EXISTS idx_hunches_participant ON hunches(participant_id);

CREATE TABLE IF NOT EXISTS hunch_evidence (
  id TEXT PRIMARY KEY,
  hunch_id TEXT NOT NULL REFERENCES hunches(id) ON DELETE CASCADE,
  plan_id TEXT,
  session_id TEXT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hunch_evidence_hunch ON hunch_evidence(hunch_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open', 'ended')) DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

CREATE TABLE IF NOT EXISTS plan_specs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_spec_id TEXT REFERENCES plan_specs(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  scale TEXT NOT NULL CHECK (scale IN ('day_off', 'weekend', 'getaway', 'vacation')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  radius_km INTEGER NOT NULL,
  mood_context TEXT,
  generation_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_specs_user ON plan_specs(user_id);

CREATE TABLE IF NOT EXISTS spec_participants (
  plan_spec_id TEXT NOT NULL REFERENCES plan_specs(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_spec_id, participant_id)
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  plan_spec_id TEXT NOT NULL REFERENCES plan_specs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  score_breakdown JSONB,
  rank INTEGER,
  rejected BOOLEAN NOT NULL DEFAULT false,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_spec ON candidates(plan_spec_id);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_spec_id TEXT NOT NULL REFERENCES plan_specs(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('locked', 'rejected')),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  category TEXT NOT NULL,
  beats JSONB NOT NULL,
  weather JSONB,
  distance_km DOUBLE PRECISION,
  place_provenance JSONB NOT NULL,
  active_constraints JSONB NOT NULL,
  rejection_reason TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_spec ON plans(plan_spec_id);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  fact_id TEXT NOT NULL,
  quote TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_citations_plan ON citations(plan_id);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_plan ON feedback(plan_id);

CREATE TABLE IF NOT EXISTS resolver_venues (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  cache JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolver_venues_external ON resolver_venues(external_id);

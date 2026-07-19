ALTER TABLE feedback ADD COLUMN reaction TEXT
;

UPDATE feedback
SET reaction = CASE
  WHEN rating <= 2 THEN 'dislike'
  WHEN rating >= 5 THEN 'love'
  ELSE 'like'
END
WHERE reaction IS NULL
;

ALTER TABLE feedback ALTER COLUMN reaction SET NOT NULL
;

ALTER TABLE feedback ADD CONSTRAINT feedback_reaction_check
  CHECK (reaction IN ('dislike', 'like', 'love'))
;

ALTER TABLE feedback ADD COLUMN feature_summary TEXT
;

ALTER TABLE feedback ADD COLUMN features JSONB NOT NULL DEFAULT '[]'::jsonb
;

CREATE TABLE candidate_reactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('dislike', 'like', 'love')),
  feature_summary TEXT,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, candidate_id)
)
;

CREATE INDEX idx_candidate_reactions_user ON candidate_reactions(user_id)
;

CREATE TABLE friend_invites (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;

CREATE INDEX idx_friend_invites_inviter ON friend_invites(inviter_user_id)
;

CREATE TABLE friendships (
  user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
)
;

CREATE INDEX idx_friendships_b ON friendships(user_b_id)
;

CREATE TABLE plan_shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  snapshot JSONB NOT NULL,
  sanitizer_version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;

CREATE INDEX idx_plan_shares_user ON plan_shares(user_id)
;

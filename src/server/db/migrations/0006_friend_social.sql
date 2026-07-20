-- Reversible blocking: directional per (blocker, blocked) rows so either
-- side of a pair can independently block/unblock without disturbing the
-- other's state, and so we can tell "who blocked whom" server-side even
-- though the API never reveals that to the blocked party. A block ends any
-- active friendship immediately; unblocking restores nothing, it only lifts
-- the prevention on future connections (enforced in acceptFriendInvite).
CREATE TABLE friend_blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
)
;

CREATE INDEX idx_friend_blocks_blocked ON friend_blocks(blocked_user_id)
;

-- Circle labels: many-to-many, per-user (owner) namespace. Preset labels
-- ("Family", "Close friends") are just ordinary rows created on first use --
-- no special flag needed. A composite UNIQUE on (id, owner_user_id) lets the
-- assignment table's foreign key guarantee an assignment can never point at
-- another user's label, even if a label id were guessed.
CREATE TABLE friend_labels (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 24 AND char_length(trim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name),
  UNIQUE (id, owner_user_id)
)
;

CREATE TABLE friend_label_assignments (
  label_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (label_id, friend_user_id),
  FOREIGN KEY (label_id, owner_user_id) REFERENCES friend_labels(id, owner_user_id) ON DELETE CASCADE
)
;

CREATE INDEX idx_friend_label_assignments_owner_friend ON friend_label_assignments(owner_user_id, friend_user_id)
;

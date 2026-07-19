CREATE TABLE plan_chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_spec_id TEXT NOT NULL REFERENCES plan_specs(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  action JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;

CREATE INDEX idx_plan_chat_messages_thread ON plan_chat_messages(plan_spec_id, created_at)
;

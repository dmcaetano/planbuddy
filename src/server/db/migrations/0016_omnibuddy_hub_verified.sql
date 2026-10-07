-- Buddy Contract v1 addendum (POST /api/buddy/connect): marks accounts whose email the OmniBuddy hub vouched for
-- (created by hub connect). Self-registered accounts stay false, which is the account-takeover guard. Additive only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hub_verified BOOLEAN NOT NULL DEFAULT false;

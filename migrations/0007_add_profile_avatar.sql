-- Migration: Persist user profile avatar images
-- Description: Stores a sanitized avatar data URL for each user
-- Apply once after 0006_add_github_and_sync_code.sql.

ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE INDEX IF NOT EXISTS idx_users_avatar_url ON users(avatar_url) WHERE avatar_url IS NOT NULL;

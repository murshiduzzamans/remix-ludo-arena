-- Migration: Add github_id and sync_code to users table
-- Description: Adds GitHub OAuth and account sync/recovery code support
-- Apply once after 0001-0005. SQLite does not support IF NOT EXISTS for ADD COLUMN.

ALTER TABLE users ADD COLUMN github_id TEXT;
ALTER TABLE users ADD COLUMN sync_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_code ON users(sync_code) WHERE sync_code IS NOT NULL;

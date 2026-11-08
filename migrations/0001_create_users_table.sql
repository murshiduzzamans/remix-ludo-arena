-- Migration: Create users table
-- Description: Stores user accounts (both guest and Google-authenticated)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  avatar_id INTEGER NOT NULL DEFAULT 0,
  is_guest INTEGER NOT NULL DEFAULT 1,
  google_sub TEXT UNIQUE,
  last_seen_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

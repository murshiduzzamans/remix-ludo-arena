-- Phase 1 Security Migration
-- Created: 2026-11-05
-- Purpose: Add tables for match idempotency and rate limiting

-- Processed matches table for idempotency protection
-- Prevents duplicate match result submissions
CREATE TABLE IF NOT EXISTS processed_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL CHECK(result IN ('victory', 'defeat')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_processed_matches_user_id ON processed_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_processed_matches_processed_at ON processed_matches(processed_at);

-- Rate limit tracking table
-- Persistent storage for rate limit enforcement
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at);

-- Cleanup function for expired rate limit entries
-- Run periodically to prevent table bloat
-- DELETE FROM rate_limits WHERE expires_at < strftime('%s', 'now');

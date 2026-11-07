-- Phase 1: Security and Data Integrity Migration
-- Created: 2026-11-05
-- Purpose: Add tables for match idempotency and rate limiting

-- ============================================================================
-- TABLE: processed_matches
-- Purpose: Prevent duplicate match result processing and reward double-claiming
-- ============================================================================
CREATE TABLE IF NOT EXISTS processed_matches (
  match_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  processed_at INTEGER NOT NULL,
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL CHECK(result IN ('victory', 'defeat')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_processed_matches_user_id
  ON processed_matches(user_id);

CREATE INDEX IF NOT EXISTS idx_processed_matches_processed_at
  ON processed_matches(processed_at);

-- ============================================================================
-- TABLE: rate_limits
-- Purpose: SQLite-backed persistent rate limiting
-- Schema: identifier (user_id:action or ip:action), count, window_start, window_end
-- ============================================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  identifier TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end
  ON rate_limits(window_end);

-- ============================================================================
-- TABLE: claimed_rewards
-- Purpose: Track claimed daily/prize rewards for idempotency
-- ============================================================================
CREATE TABLE IF NOT EXISTS claimed_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, reward_type, reward_id)
);

CREATE INDEX IF NOT EXISTS idx_claimed_rewards_user_id
  ON claimed_rewards(user_id);

CREATE INDEX IF NOT EXISTS idx_claimed_rewards_claimed_at
  ON claimed_rewards(claimed_at);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify migration success:
-- SELECT name FROM sqlite_master WHERE type='table' AND name IN ('processed_matches', 'rate_limits', 'claimed_rewards');
-- SELECT COUNT(*) FROM processed_matches;
-- SELECT COUNT(*) FROM rate_limits;
-- SELECT COUNT(*) FROM claimed_rewards;

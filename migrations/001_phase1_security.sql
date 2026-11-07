-- Phase 1 Security Migration
-- Created: 2026-11-05
-- Purpose: Add tables for idempotency, rate limiting, and audit logging

-- ============================================================================
-- 1. PROCESSED MATCHES TABLE (Idempotency)
-- ============================================================================
-- Prevents duplicate match result processing
CREATE TABLE IF NOT EXISTS processed_matches (
  match_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL, -- Unix timestamp
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL, -- 'win', 'loss', 'draw'
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_processed_matches_user_id
  ON processed_matches(user_id);

CREATE INDEX IF NOT EXISTS idx_processed_matches_processed_at
  ON processed_matches(processed_at);

-- ============================================================================
-- 2. RATE LIMIT TABLE (SQLite-backed persistent rate limiting)
-- ============================================================================
-- Tracks API request counts per user/IP per time window
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE, -- Format: "endpoint:identifier:window"
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL, -- Unix timestamp
  window_end INTEGER NOT NULL, -- Unix timestamp
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key
  ON rate_limits(key);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end
  ON rate_limits(window_end);

-- ============================================================================
-- 3. ADMIN AUDIT LOG TABLE (Security auditing)
-- ============================================================================
-- Logs all admin actions for security auditing
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create_prize', 'update_prize', 'delete_prize', etc.
  resource_type TEXT NOT NULL, -- 'prize', 'user', 'settings'
  resource_id TEXT, -- ID of the affected resource
  details TEXT, -- JSON string with additional context
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_user_id
  ON admin_audit_log(admin_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON admin_audit_log(action);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON admin_audit_log(created_at);

-- ============================================================================
-- 4. CLEANUP FUNCTION COMMENTS
-- ============================================================================
-- NOTE: Cleanup of old rate_limit entries should be handled by:
--   DELETE FROM rate_limits WHERE window_end < (current_timestamp - grace_period)
--
-- NOTE: Admin audit logs should be retained for compliance.
--   Consider archiving logs older than 90 days to a separate table.

-- Phase 1 Security Migration
-- Created: 2026-11-05
-- Purpose: Add idempotency, rate limiting, and audit tables

-- ============================================================
-- 1. PROCESSED MATCHES TABLE (Idempotency)
-- ============================================================
-- Prevents duplicate match result submissions
-- UNIQUE constraint on matchId ensures atomic check-and-insert
CREATE TABLE IF NOT EXISTS processed_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matchId TEXT NOT NULL UNIQUE,
  userId INTEGER NOT NULL,
  gameMode TEXT NOT NULL,
  humanColor TEXT NOT NULL,
  place INTEGER NOT NULL,
  captureCount INTEGER NOT NULL,
  coinsAwarded INTEGER NOT NULL DEFAULT 0,
  xpAwarded INTEGER NOT NULL DEFAULT 0,
  processedAt INTEGER NOT NULL, -- Unix timestamp
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_processed_matches_userId
  ON processed_matches(userId);
CREATE INDEX IF NOT EXISTS idx_processed_matches_processedAt
  ON processed_matches(processedAt);

-- ============================================================
-- 2. RATE LIMIT TABLE (Persistent Rate Limiting)
-- ============================================================
-- Stores rate limit counters with expiration
-- key format: "endpoint:identifier" e.g. "match-result:user:123" or "claim-reward:ip:192.168.1.1"
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  expiresAt INTEGER NOT NULL -- Unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expiresAt
  ON rate_limits(expiresAt);

-- ============================================================
-- 3. ADMIN AUDIT LOG (Security Tracking)
-- ============================================================
-- Logs all admin actions for security audit trail
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'create_prize', 'update_prize', 'delete_prize', 'update_user', etc.
  resourceType TEXT, -- 'prize', 'user', 'config', etc.
  resourceId TEXT,
  details TEXT, -- JSON string with action details
  ipAddress TEXT,
  userAgent TEXT,
  createdAt INTEGER NOT NULL, -- Unix timestamp
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_userId
  ON admin_audit_log(userId);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action
  ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_createdAt
  ON admin_audit_log(createdAt);

-- ============================================================
-- 4. ADD MISSING CONSTRAINTS TO EXISTING TABLES
-- ============================================================
-- Note: SQLite does not support adding constraints to existing tables
-- These will be enforced in application code and documented here

-- users table should have:
-- - UNIQUE constraint on username (already exists)
-- - CHECK constraint: coins >= 0
-- - CHECK constraint: xp >= 0

-- prizes table should have:
-- - CHECK constraint: coins >= 0
-- - CHECK constraint: probability >= 0 AND probability <= 100

-- These constraints are enforced in application code via validation functions

-- Migration: Create matches table
-- Description: Stores finished match metadata

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  finished_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  player_count INTEGER NOT NULL,
  had_bots INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at DESC);

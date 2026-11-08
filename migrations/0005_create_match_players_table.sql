-- Migration: Create match_players table
-- Description: Stores individual player results for each match

CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL,
  user_id TEXT,
  color TEXT NOT NULL,
  placement INTEGER,
  captures INTEGER NOT NULL DEFAULT 0,
  tokens_finished INTEGER NOT NULL DEFAULT 0,
  xp_gained INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (match_id, color)
);

CREATE INDEX IF NOT EXISTS idx_match_players_user_id ON match_players(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON match_players(match_id);

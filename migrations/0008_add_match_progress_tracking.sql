-- Migration: Publish and track match progress synchronization
-- Description: Adds publication and sync tracking metadata for owner-linked matches
-- Apply once after 0007_add_profile_avatar.sql.

ALTER TABLE matches ADD COLUMN published_at INTEGER;
ALTER TABLE matches ADD COLUMN owner_user_id TEXT;
ALTER TABLE matches ADD COLUMN progress_synced_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_matches_owner_user_id ON matches(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_progress_synced_at ON matches(progress_synced_at) WHERE progress_synced_at IS NOT NULL;

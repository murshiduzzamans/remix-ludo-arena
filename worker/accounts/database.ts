/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Database access layer for accounts
 * All D1 operations with proper error handling and batching
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { User, Session, PlayerStats, Match, MatchPlayer, LeaderboardEntry, PublicProfile, UserWithStats } from './types';
import { hashToken } from '../auth/crypto';
import { calculateLevel } from './config';

/**
 * Creates a new guest user
 */
export async function createGuestUser(
  db: D1Database,
  displayName: string,
  avatarId: number
): Promise<User> {
  const now = Date.now();
  const user: User = {
    id: crypto.randomUUID(),
    createdAt: now,
    displayName,
    avatarId,
    isGuest: true,
    googleSub: null,
    lastSeenAt: now,
    deletedAt: null,
  };

  // Use batch to create user and initialize stats atomically
  const results = await db.batch([
    db.prepare(
      `INSERT INTO users (id, created_at, display_name, avatar_id, is_guest, google_sub, last_seen_at, deleted_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, NULL)`
    ).bind(user.id, user.createdAt, user.displayName, user.avatarId, user.lastSeenAt),
    db.prepare(
      `INSERT INTO player_stats (user_id, games_played, wins, losses, abandons, captures, tokens_finished, xp, level, practice_games, updated_at)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0, 1, 0, ?)`
    ).bind(user.id, now),
  ]);

  if (!results[0].success || !results[1].success) {
    throw new Error('Failed to create guest user');
  }

  return user;
}

/**
 * Creates a new session for a user
 */
export async function createSession(
  db: D1Database,
  userId: string,
  sessionToken: string,
  durationMs: number
): Promise<Session> {
  const now = Date.now();
  const idHash = await hashToken(sessionToken);

  const session: Session = {
    idHash,
    userId,
    createdAt: now,
    expiresAt: now + durationMs,
    lastSeenAt: now,
  };

  await db.prepare(
    `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(session.idHash, session.userId, session.createdAt, session.expiresAt, session.lastSeenAt).run();

  return session;
}

/**
 * Finds a session by token and updates last seen
 */
export async function findAndRefreshSession(
  db: D1Database,
  sessionToken: string,
  slidingWindowMs: number
): Promise<{ session: Session; user: User } | null> {
  const idHash = await hashToken(sessionToken);
  const now = Date.now();

  // Find session and user
  const result = await db.prepare(
    `SELECT
      s.id_hash, s.user_id, s.created_at, s.expires_at, s.last_seen_at,
      u.id, u.created_at as user_created_at, u.display_name, u.avatar_id, u.is_guest, u.google_sub, u.last_seen_at as user_last_seen_at, u.deleted_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`
  ).bind(idHash, now).first();

  if (!result) return null;

  const session: Session = {
    idHash: result.id_hash as string,
    userId: result.user_id as string,
    createdAt: result.created_at as number,
    expiresAt: result.expires_at as number,
    lastSeenAt: result.last_seen_at as number,
  };

  const user: User = {
    id: result.id as string,
    createdAt: result.user_created_at as number,
    displayName: result.display_name as string,
    avatarId: result.avatar_id as number,
    isGuest: Boolean(result.is_guest),
    googleSub: result.google_sub as string | null,
    lastSeenAt: result.user_last_seen_at as number,
    deletedAt: result.deleted_at as number | null,
  };

  // Update last seen if older than sliding window
  if (now - session.lastSeenAt > slidingWindowMs) {
    await db.batch([
      db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?`).bind(now, idHash),
      db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now, user.id),
    ]);
    session.lastSeenAt = now;
    user.lastSeenAt = now;
  }

  return { session, user };
}

/**
 * Deletes a session
 */
export async function deleteSession(db: D1Database, sessionToken: string): Promise<void> {
  const idHash = await hashToken(sessionToken);
  await db.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(idHash).run();
}

/**
 * Finds a user by Google sub
 */
export async function findUserByGoogleSub(db: D1Database, googleSub: string): Promise<User | null> {
  const result = await db.prepare(
    `SELECT id, created_at, display_name, avatar_id, is_guest, google_sub, last_seen_at, deleted_at
     FROM users
     WHERE google_sub = ? AND deleted_at IS NULL`
  ).bind(googleSub).first();

  if (!result) return null;

  return {
    id: result.id as string,
    createdAt: result.created_at as number,
    displayName: result.display_name as string,
    avatarId: result.avatar_id as number,
    isGuest: Boolean(result.is_guest),
    googleSub: result.google_sub as string | null,
    lastSeenAt: result.last_seen_at as number,
    deletedAt: result.deleted_at as number | null,
  };
}

/**
 * Links a Google account to a guest user
 */
export async function linkGoogleAccount(
  db: D1Database,
  userId: string,
  googleSub: string,
  displayName: string
): Promise<void> {
  await db.prepare(
    `UPDATE users
     SET google_sub = ?, is_guest = 0, display_name = ?
     WHERE id = ?`
  ).bind(googleSub, displayName, userId).run();
}

/**
 * Merges guest stats into existing Google account (one-time)
 */
export async function mergeGuestIntoAccount(
  db: D1Database,
  targetUserId: string,
  guestUserId: string
): Promise<void> {
  const now = Date.now();

  // Get both users' stats
  const [targetStats, guestStats] = await Promise.all([
    db.prepare(`SELECT * FROM player_stats WHERE user_id = ?`).bind(targetUserId).first(),
    db.prepare(`SELECT * FROM player_stats WHERE user_id = ?`).bind(guestUserId).first(),
  ]);

  if (!targetStats || !guestStats) {
    throw new Error('Stats not found for merge');
  }

  // Sum all stats
  const mergedStats = {
    gamesPlayed: (targetStats.games_played as number) + (guestStats.games_played as number),
    wins: (targetStats.wins as number) + (guestStats.wins as number),
    losses: (targetStats.losses as number) + (guestStats.losses as number),
    abandons: (targetStats.abandons as number) + (guestStats.abandons as number),
    captures: (targetStats.captures as number) + (guestStats.captures as number),
    tokensFinished: (targetStats.tokens_finished as number) + (guestStats.tokens_finished as number),
    xp: (targetStats.xp as number) + (guestStats.xp as number),
    practiceGames: (targetStats.practice_games as number) + (guestStats.practice_games as number),
  };

  mergedStats.xp = Math.max(mergedStats.xp, 0); // Ensure non-negative
  const level = calculateLevel(mergedStats.xp);

  // Update target user stats, reassign guest's matches, delete guest
  await db.batch([
    db.prepare(
      `UPDATE player_stats
       SET games_played = ?, wins = ?, losses = ?, abandons = ?, captures = ?, tokens_finished = ?, xp = ?, level = ?, practice_games = ?, updated_at = ?
       WHERE user_id = ?`
    ).bind(
      mergedStats.gamesPlayed, mergedStats.wins, mergedStats.losses, mergedStats.abandons,
      mergedStats.captures, mergedStats.tokensFinished, mergedStats.xp, level,
      mergedStats.practiceGames, now, targetUserId
    ),
    // Reassign match_players records to target user
    db.prepare(`UPDATE match_players SET user_id = ? WHERE user_id = ?`).bind(targetUserId, guestUserId),
    // Delete guest user and related data
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(guestUserId),
    db.prepare(`DELETE FROM player_stats WHERE user_id = ?`).bind(guestUserId),
    db.prepare(`DELETE FROM users WHERE id = ?`).bind(guestUserId),
  ]);
}

/**
 * Gets user with stats
 */
export async function getUserWithStats(db: D1Database, userId: string): Promise<UserWithStats | null> {
  const result = await db.prepare(
    `SELECT
      u.id, u.created_at, u.display_name, u.avatar_id, u.is_guest, u.google_sub, u.last_seen_at, u.deleted_at,
      s.games_played, s.wins, s.losses, s.abandons, s.captures, s.tokens_finished, s.xp, s.level, s.practice_games, s.updated_at
     FROM users u
     LEFT JOIN player_stats s ON u.id = s.user_id
     WHERE u.id = ? AND u.deleted_at IS NULL`
  ).bind(userId).first();

  if (!result) return null;

  const user: User = {
    id: result.id as string,
    createdAt: result.created_at as number,
    displayName: result.display_name as string,
    avatarId: result.avatar_id as number,
    isGuest: Boolean(result.is_guest),
    googleSub: result.google_sub as string | null,
    lastSeenAt: result.last_seen_at as number,
    deletedAt: result.deleted_at as number | null,
  };

  const stats: PlayerStats = {
    userId: result.id as string,
    gamesPlayed: (result.games_played as number) ?? 0,
    wins: (result.wins as number) ?? 0,
    losses: (result.losses as number) ?? 0,
    abandons: (result.abandons as number) ?? 0,
    captures: (result.captures as number) ?? 0,
    tokensFinished: (result.tokens_finished as number) ?? 0,
    xp: (result.xp as number) ?? 0,
    level: (result.level as number) ?? 1,
    practiceGames: (result.practice_games as number) ?? 0,
    updatedAt: (result.updated_at as number) ?? Date.now(),
  };

  return { ...user, stats };
}

/**
 * Updates user profile
 */
export async function updateUserProfile(
  db: D1Database,
  userId: string,
  displayName: string,
  avatarId: number
): Promise<void> {
  await db.prepare(
    `UPDATE users SET display_name = ?, avatar_id = ? WHERE id = ?`
  ).bind(displayName, avatarId, userId).run();
}

/**
 * Soft deletes a user account
 */
export async function deleteUserAccount(db: D1Database, userId: string): Promise<void> {
  const now = Date.now();

  await db.batch([
    // Soft delete user
    db.prepare(`UPDATE users SET deleted_at = ?, display_name = 'Deleted User' WHERE id = ?`).bind(now, userId),
    // Delete sessions
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    // Anonymize match_players (set user_id to NULL, keeping match history)
    db.prepare(`UPDATE match_players SET user_id = NULL WHERE user_id = ?`).bind(userId),
  ]);
}

/**
 * Gets public profile for a user
 */
export async function getPublicProfile(db: D1Database, userId: string): Promise<PublicProfile | null> {
  const result = await db.prepare(
    `SELECT u.id, u.display_name, u.avatar_id, s.level, s.games_played, s.wins
     FROM users u
     LEFT JOIN player_stats s ON u.id = s.user_id
     WHERE u.id = ? AND u.deleted_at IS NULL`
  ).bind(userId).first();

  if (!result) return null;

  const gamesPlayed = (result.games_played as number) ?? 0;
  const wins = (result.wins as number) ?? 0;

  return {
    id: result.id as string,
    displayName: result.display_name as string,
    avatarId: result.avatar_id as number,
    level: (result.level as number) ?? 1,
    stats: {
      gamesPlayed,
      wins,
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
    },
  };
}

/**
 * Gets leaderboard (top players by wins, min 5 games)
 */
export async function getLeaderboard(db: D1Database, limit: number): Promise<LeaderboardEntry[]> {
  const results = await db.prepare(
    `SELECT u.id, u.display_name, u.avatar_id, s.level, s.wins, s.games_played
     FROM player_stats s
     JOIN users u ON s.user_id = u.id
     WHERE u.deleted_at IS NULL AND s.games_played >= 5
     ORDER BY s.wins DESC, s.games_played ASC
     LIMIT ?`
  ).bind(limit).all();

  if (!results.results) return [];

  return results.results.map((row) => {
    const gamesPlayed = row.games_played as number;
    const wins = row.wins as number;
    return {
      userId: row.id as string,
      displayName: row.display_name as string,
      avatarId: row.avatar_id as number,
      level: row.level as number,
      wins,
      gamesPlayed,
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
    };
  });
}

/**
 * Records a finished match with all player results (idempotent)
 */
export async function recordMatch(
  db: D1Database,
  match: Match,
  players: MatchPlayer[]
): Promise<void> {
  const now = Date.now();

  // Check if match already recorded (idempotency)
  const existing = await db.prepare(`SELECT id FROM matches WHERE id = ?`).bind(match.id).first();
  if (existing) return; // Already recorded, skip

  // Build batch operations
  const operations = [
    // Insert match
    db.prepare(
      `INSERT INTO matches (id, finished_at, mode, player_count, had_bots)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(match.id, match.finishedAt, match.mode, match.playerCount, match.hadBots ? 1 : 0),
  ];

  // Insert match_players
  for (const player of players) {
    operations.push(
      db.prepare(
        `INSERT INTO match_players (match_id, user_id, color, placement, captures, tokens_finished, xp_gained, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        player.matchId,
        player.userId,
        player.color,
        player.placement,
        player.captures,
        player.tokensFinished,
        player.xpGained,
        player.outcome
      )
    );

    // Update player stats if user exists
    if (player.userId) {
      operations.push(
        db.prepare(
          `UPDATE player_stats
           SET games_played = games_played + 1,
               wins = wins + ?,
               losses = losses + ?,
               abandons = abandons + ?,
               captures = captures + ?,
               tokens_finished = tokens_finished + ?,
               xp = xp + ?,
               level = ?,
               practice_games = practice_games + ?,
               updated_at = ?
           WHERE user_id = ?`
        ).bind(
          player.outcome === 'win' ? 1 : 0,
          player.outcome === 'loss' ? 1 : 0,
          player.outcome === 'abandon' ? 1 : 0,
          player.captures,
          player.tokensFinished,
          player.xpGained,
          calculateLevel((await db.prepare(`SELECT xp FROM player_stats WHERE user_id = ?`).bind(player.userId).first())?.xp as number ?? 0) + player.xpGained,
          match.hadBots ? 1 : 0,
          now,
          player.userId
        )
      );
    }
  }

  await db.batch(operations);
}

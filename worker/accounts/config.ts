/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Account system configuration and constants
 */

/**
 * XP and level calculation rules
 */
export const XP_RULES = {
  // Base XP per game (all games)
  BASE_XP: 10,

  // Bonus XP for winning
  WIN_BONUS: 50,

  // XP per capture
  CAPTURE_XP: 5,

  // XP per token finished
  TOKEN_FINISHED_XP: 2,

  // Practice game multiplier (games with bots)
  PRACTICE_MULTIPLIER: 0.5,

  // Minimum humans required for ranked stats
  MIN_HUMANS_FOR_RANKED: 2,
} as const;

/**
 * Calculates level from XP
 * Formula: level = floor(sqrt(XP / 100)) + 1
 */
export function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/**
 * Calculates XP for a match result
 */
export function calculateMatchXp(
  outcome: 'win' | 'loss' | 'abandon',
  captures: number,
  tokensFinished: number,
  isPractice: boolean
): number {
  let xp: number = XP_RULES.BASE_XP;

  if (outcome === 'win') {
    xp += XP_RULES.WIN_BONUS;
  }

  xp += captures * XP_RULES.CAPTURE_XP;
  xp += tokensFinished * XP_RULES.TOKEN_FINISHED_XP;

  // Reduce XP for practice games
  if (isPractice) {
    xp = Math.floor(xp * XP_RULES.PRACTICE_MULTIPLIER);
  }

  return Math.max(0, xp);
}

/**
 * Avatar preset IDs
 */
export const AVATAR_PRESETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export type AvatarPreset = typeof AVATAR_PRESETS[number];

/**
 * Session configuration
 */
export const SESSION_CONFIG = {
  DURATION_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  SLIDING_WINDOW_MS: 24 * 60 * 60 * 1000, // Refresh if older than 1 day
} as const;

/**
 * Leaderboard configuration
 */
export const LEADERBOARD_CONFIG = {
  MAX_ENTRIES: 50,
  CACHE_TTL_SECONDS: 60,
  MIN_GAMES_PLAYED: 5, // Minimum games to appear on leaderboard
} as const;

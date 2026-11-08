/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type definitions for account system
 */

export interface User {
  id: string;
  createdAt: number;
  displayName: string;
  avatarId: number;
  isGuest: boolean;
  googleSub: string | null;
  lastSeenAt: number;
  deletedAt: number | null;
}

export interface Session {
  idHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export interface PlayerStats {
  userId: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  abandons: number;
  captures: number;
  tokensFinished: number;
  xp: number;
  level: number;
  practiceGames: number;
  updatedAt: number;
}

export interface Match {
  id: string;
  finishedAt: number;
  mode: string;
  playerCount: number;
  hadBots: boolean;
}

export interface MatchPlayer {
  matchId: string;
  userId: string | null;
  color: string;
  placement: number | null;
  captures: number;
  tokensFinished: number;
  xpGained: number;
  outcome: 'win' | 'loss' | 'abandon';
}

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarId: number;
  level: number;
  stats: {
    gamesPlayed: number;
    wins: number;
    winRate: number;
  };
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarId: number;
  level: number;
  wins: number;
  gamesPlayed: number;
  winRate: number;
}

export interface UserWithStats extends User {
  stats: PlayerStats;
}

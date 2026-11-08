/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Progress recording system for finished games
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { GameState, PlayerColor } from '../../src/engine/types';
import { recordMatch } from './database';
import { calculateMatchXp, XP_RULES } from './config';
import type { Match, MatchPlayer } from './types';

/**
 * Records a finished match with all player results
 * Idempotent - safe to call multiple times with same matchId
 */
export async function recordFinishedGame(
  db: D1Database,
  matchId: string,
  gameState: GameState,
  userIdByColor: Record<PlayerColor, string | undefined>,
  ownerUserId?: string | null
): Promise<void> {
  if (gameState.phase !== 'game_over') {
    throw new Error('Cannot record unfinished game');
  }

  const now = Date.now();
  const playerCount = gameState.players.filter(p => p.isActiveInMatch !== false).length;
  const hadBots = gameState.players.some(p => p.isBot);

  // Determine if this is a practice game (for XP reduction)
  const humanCount = gameState.players.filter(p => !p.isBot && p.isActiveInMatch !== false).length;
  const isPractice = hadBots || humanCount < XP_RULES.MIN_HUMANS_FOR_RANKED;

  const match: Match = {
    id: matchId,
    finishedAt: now,
    mode: gameState.mode,
    playerCount,
    hadBots,
    publishedAt: now,
    ownerUserId: ownerUserId ?? null,
    progressSyncedAt: ownerUserId ? now : null,
  };

  const matchPlayers: MatchPlayer[] = [];

  // Determine placements and outcomes
  for (const player of gameState.players) {
    if (player.isActiveInMatch === false) continue;

    const userId = userIdByColor[player.color];

    // Determine outcome
    let outcome: 'win' | 'loss' | 'abandon';
    if (gameState.isTeamMode) {
      // Team mode: check if player's team won
      const isWinner = player.teamId === gameState.winningTeam;
      outcome = isWinner ? 'win' : 'loss';
    } else {
      // Individual mode: check if player is in winners list
      const isWinner = gameState.winners.includes(player.color);
      outcome = isWinner ? 'win' : 'loss';
    }

    // Determine placement (1st, 2nd, 3rd, 4th)
    let placement: number | null = null;
    if (!gameState.isTeamMode) {
      placement = gameState.winners.indexOf(player.color);
      if (placement === -1) {
        // Not a winner, assign remaining placement
        const winnersCount = gameState.winners.length;
        placement = winnersCount + 1;
      } else {
        placement = placement + 1; // Convert to 1-indexed
      }
    }

    // Calculate XP for this player
    const xpGained = calculateMatchXp(
      outcome,
      player.captures,
      player.tokensFinished,
      isPractice
    );

    matchPlayers.push({
      matchId,
      userId: userId ?? null,
      color: player.color,
      placement,
      captures: player.captures,
      tokensFinished: player.tokensFinished,
      xpGained,
      outcome,
    });
  }

  // Record match atomically
  await recordMatch(db, match, matchPlayers);
}

/**
 * Safely attempts to record a match with error handling
 * Returns success status without throwing
 */
export async function safeRecordMatch(
  db: D1Database | undefined,
  matchId: string,
  gameState: GameState,
  userIdByColor: Record<PlayerColor, string | undefined>,
  ownerUserId?: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    await recordFinishedGame(db, matchId, gameState, userIdByColor, ownerUserId);
    return { success: true };
  } catch (error) {
    console.error('Failed to record match:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

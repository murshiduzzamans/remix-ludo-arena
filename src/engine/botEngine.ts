/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  COLOR_START_TRACK_INDEX,
  COLOR_TEAMS,
  LAST_TRACK_STEP,
  TOTAL_TRACK_CELLS,
} from './constants';
import { findCapturableTokens, isSafeCell } from './rules';
import { BotDifficulty, BotPersonality, GameRules, MoveAction, Player, PlayerColor } from './types';

function trackIndex(color: PlayerColor, step: number): number {
  return (COLOR_START_TRACK_INDEX[color] + step) % TOTAL_TRACK_CELLS;
}

function areTeammates(colorA: PlayerColor, colorB: PlayerColor, players: Player[], isTeamMode: boolean): boolean {
  if (!isTeamMode) return false;
  const playerA = players.find((player) => player.color === colorA);
  const playerB = players.find((player) => player.color === colorB);
  if (playerA?.teamId !== undefined && playerB?.teamId !== undefined) return playerA.teamId === playerB.teamId;
  return COLOR_TEAMS[colorA] === COLOR_TEAMS[colorB];
}

function isCellThreatened(
  targetTrackIdx: number,
  movingColor: PlayerColor,
  allPlayers: Player[],
  rules: GameRules,
  isTeamMode: boolean
): boolean {
  if (isSafeCell(targetTrackIdx, rules)) return false;
  for (const opponent of allPlayers) {
    if (opponent.color === movingColor) continue;
    if (areTeammates(opponent.color, movingColor, allPlayers, isTeamMode)) continue;
    for (const token of opponent.tokens) {
      if (token.stepCount < 0 || token.stepCount > LAST_TRACK_STEP) continue;
      const opponentCell = trackIndex(opponent.color, token.stepCount);
      const distance = (targetTrackIdx - opponentCell + TOTAL_TRACK_CELLS) % TOTAL_TRACK_CELLS;
      if (distance < 1 || distance > 6 || token.stepCount + distance > LAST_TRACK_STEP) continue;
      let blocked = false;
      if (rules.blocksEnabled && rules.blockStopsPassing) {
        for (let step = 1; step < distance; step += 1) {
          const cell = (opponentCell + step) % TOTAL_TRACK_CELLS;
          const blockCount = allPlayers.reduce((total, player) => {
            if (player.color === opponent.color || areTeammates(player.color, opponent.color, allPlayers, isTeamMode)) return total;
            return total + player.tokens.filter((other) => other.stepCount >= 0 && other.stepCount <= LAST_TRACK_STEP && trackIndex(other.color, other.stepCount) === cell).length;
          }, 0);
          if (blockCount >= 2) { blocked = true; break; }
        }
      }
      if (!blocked) return true;
    }
  }
  return false;
}

function scoreMove(move: MoveAction, player: Player, allPlayers: Player[], rules: GameRules, isTeamMode: boolean): number {
  const personality: BotPersonality = player.botPersonality ?? 'balanced';
  const color = move.tokenColor ?? player.color;
  const destinationCell = move.toStep <= LAST_TRACK_STEP ? trackIndex(color, move.toStep) : -1;
  const safe = destinationCell >= 0 && isSafeCell(destinationCell, rules);
  const threatened = destinationCell >= 0 && isCellThreatened(destinationCell, color, allPlayers, rules, isTeamMode);
  const hasCapture = move.willCaptureTokens.length > 0;
  let score = move.toStep;

  if (move.isFinish) score += personality === 'defensive' ? 1500 : 1200;
  if (move.isExitYard) score += 350;
  if (safe) score += personality === 'defensive' ? 600 : 250;
  if (hasCapture) {
    score += personality === 'aggressive' ? 1400 : 700;
    score += Math.max(...move.willCaptureTokens.map((victim) => victim.stepCount)) * 8;
  }
  if (threatened) score -= personality === 'defensive' ? 900 : personality === 'aggressive' ? 120 : 450;

  const sourceCell = move.fromStep >= 0 && move.fromStep <= LAST_TRACK_STEP ? trackIndex(color, move.fromStep) : -1;
  if (sourceCell >= 0 && isCellThreatened(sourceCell, color, allPlayers, rules, isTeamMode) && !threatened) score += 500;
  if (rules.blocksEnabled && destinationCell >= 0) {
    const friendlyCount = allPlayers.filter((candidate) => candidate.color === color)
      .flatMap((candidate) => candidate.tokens)
      .filter((token) => token.stepCount >= 0 && token.stepCount <= LAST_TRACK_STEP && trackIndex(color, token.stepCount) === destinationCell).length;
    if (friendlyCount === 1) score += 250;
  }
  if (personality === 'balanced' && !hasCapture) score += move.toStep * 5;
  return score;
}

export function chooseBotMove(
  legalMoves: MoveAction[],
  player: Player,
  allPlayers: Player[],
  rules: GameRules,
  isTeamMode: boolean,
  rng: () => number = () => 0
): MoveAction | null {
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  const difficulty: BotDifficulty = player.difficulty ?? 'medium';
  if (difficulty === 'easy') {
    const captures = legalMoves.filter((move) => move.willCaptureTokens.length > 0);
    const pool = captures.length ? captures : legalMoves;
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
    return pool[index];
  }

  const scored = legalMoves.map((move) => {
    let score = scoreMove(move, player, allPlayers, rules, isTeamMode);
    if (difficulty === 'hard' && !move.isExitYard && move.toStep <= LAST_TRACK_STEP) {
      const color = move.tokenColor ?? player.color;
      const cell = trackIndex(color, move.toStep);
      // Exposed lanes are risky; distance-six attackers receive double weight.
      let risk = 0;
      for (const opponent of allPlayers) {
        if (opponent.color === color || areTeammates(opponent.color, color, allPlayers, isTeamMode)) continue;
        for (const token of opponent.tokens) {
          if (token.stepCount < 0 || token.stepCount > LAST_TRACK_STEP) continue;
          const from = trackIndex(opponent.color, token.stepCount);
          const distance = (cell - from + TOTAL_TRACK_CELLS) % TOTAL_TRACK_CELLS;
          if (distance >= 1 && distance <= 6 && token.stepCount + distance <= LAST_TRACK_STEP) risk += distance === 6 ? 2 : 1;
        }
      }
      score -= risk * 110;
    }
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.move ?? null;
}

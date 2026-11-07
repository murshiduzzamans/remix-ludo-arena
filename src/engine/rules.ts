/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  COLOR_START_TRACK_INDEX,
  COLOR_TEAMS,
  HOME_COLUMN_START,
  LAST_TRACK_STEP,
  START_TRACK_CELLS,
  STAR_TRACK_CELLS,
  TOTAL_STEPS_TO_FINISH,
  TOTAL_TRACK_CELLS,
  YARD_STEP,
} from './constants';
import { GameRules, MoveAction, Player, PlayerColor, TokenState } from './types';

export function validateDiceValue(diceValue: number): boolean {
  return Number.isInteger(diceValue) && diceValue >= 1 && diceValue <= 6;
}

export function canExitYard(diceValue: number, rules: GameRules): boolean {
  return rules.sixToExit ? diceValue === 6 : diceValue === 1 || diceValue === 6;
}

export function isSafeCell(trackIdx: number, rules: GameRules): boolean {
  return (rules.startSquaresAlwaysSafe && START_TRACK_CELLS.has(trackIdx)) ||
    (rules.safeStarsActive && STAR_TRACK_CELLS.has(trackIdx));
}

export function getMoveDestination(fromStep: number, diceValue: number, isExitYard = false): number {
  return isExitYard ? 0 : fromStep + diceValue;
}

function trackIndex(color: PlayerColor, step: number): number {
  return (COLOR_START_TRACK_INDEX[color] + step) % TOTAL_TRACK_CELLS;
}

function teammates(playerA: Player, playerB: Player, isTeamMode: boolean): boolean {
  if (!isTeamMode) return false;
  if (playerA.teamId !== undefined && playerB.teamId !== undefined) return playerA.teamId === playerB.teamId;
  return COLOR_TEAMS[playerA.color] === COLOR_TEAMS[playerB.color];
}

function tokensAtTrackCell(allPlayers: Player[], idx: number): Array<{ player: Player; token: TokenState }> {
  const found: Array<{ player: Player; token: TokenState }> = [];
  for (const player of allPlayers) {
    for (const token of player.tokens) {
      if (token.stepCount >= 0 && token.stepCount <= LAST_TRACK_STEP && trackIndex(token.color, token.stepCount) === idx) {
        found.push({ player, token });
      }
    }
  }
  return found;
}

function isOpponentBlockAt(allPlayers: Player[], idx: number, movingColor: PlayerColor, isTeamMode: boolean): boolean {
  const counts = new Map<PlayerColor, number>();
  const movingPlayer = allPlayers.find((player) => player.color === movingColor) ?? { color: movingColor } as Player;
  for (const { player } of tokensAtTrackCell(allPlayers, idx)) {
    if (player.color !== movingColor && !teammates(player, movingPlayer, isTeamMode)) {
      counts.set(player.color, (counts.get(player.color) ?? 0) + 1);
    }
  }
  return [...counts.values()].some((count) => count >= 2);
}

function pathBlocked(fromStep: number, toStep: number, movingColor: PlayerColor, allPlayers: Player[], rules: GameRules, isTeamMode: boolean): boolean {
  if (!rules.blocksEnabled || !rules.blockStopsPassing || fromStep < 0) return false;
  for (let step = fromStep + 1; step <= LAST_TRACK_STEP && step < toStep; step += 1) {
    if (isOpponentBlockAt(allPlayers, trackIndex(movingColor, step), movingColor, isTeamMode)) return true;
  }
  return false;
}

export function findCapturableTokens(
  movingColor: PlayerColor,
  targetStep: number,
  allPlayers: Player[],
  rules: GameRules,
  isTeamMode: boolean
): TokenState[] {
  if (targetStep < 0 || targetStep > LAST_TRACK_STEP) return [];
  const idx = trackIndex(movingColor, targetStep);
  if (isSafeCell(idx, rules) || rules.blocksEnabled && isOpponentBlockAt(allPlayers, idx, movingColor, isTeamMode)) return [];

  const movingPlayer = allPlayers.find((player) => player.color === movingColor) ?? { color: movingColor } as Player;
  const occupants = tokensAtTrackCell(allPlayers, idx).filter(({ player }) =>
    player.color !== movingColor && !teammates(player, movingPlayer, isTeamMode)
  );
  if (occupants.length === 0) return [];
  const targetColor = occupants[0].player.color;
  return occupants.filter(({ player }) => player.color === targetColor).map(({ token }) => token);
}

/** @deprecated Use findCapturableTokens; this wrapper is kept for old callers. */
export function findCapturableToken(
  movingColor: PlayerColor,
  targetStep: number,
  allPlayers: Player[],
  rules: GameRules,
  isTeamMode: boolean
): TokenState | null {
  return findCapturableTokens(movingColor, targetStep, allPlayers, rules, isTeamMode)[0] ?? null;
}

export function getLegalMoves(
  player: Player,
  diceValue: number,
  allPlayers: Player[],
  rules: GameRules,
  isTeamMode: boolean
): MoveAction[] {
  if (!validateDiceValue(diceValue)) return [];

  if (isTeamMode && player.hasWon && player.teamId) {
    const partner = allPlayers.find((candidate) => candidate.teamId === player.teamId && candidate.color !== player.color);
    if (!partner || partner.hasWon) return [];
    return getLegalMoves(partner, diceValue, allPlayers, rules, isTeamMode).map((move) => ({
      ...move, tokenColor: partner.color, isPartnerAssist: true,
    }));
  }

  const moves: MoveAction[] = [];
  for (const token of player.tokens) {
    if (token.isHome || token.stepCount >= TOTAL_STEPS_TO_FINISH) continue;
    const isExitYard = token.stepCount === YARD_STEP;
    if (isExitYard && !canExitYard(diceValue, rules)) continue;
    const toStep = getMoveDestination(token.stepCount, diceValue, isExitYard);
    if (!isExitYard && toStep > TOTAL_STEPS_TO_FINISH) continue;
    if (pathBlocked(token.stepCount, toStep, player.color, allPlayers, rules, isTeamMode)) continue;

    const captures = findCapturableTokens(player.color, toStep, allPlayers, rules, isTeamMode);
    if (rules.blocksEnabled && captures.length === 0 && toStep <= LAST_TRACK_STEP && isOpponentBlockAt(allPlayers, trackIndex(player.color, toStep), player.color, isTeamMode)) continue;
    moves.push({
      tokenColor: player.color,
      tokenIndex: token.index,
      fromStep: token.stepCount,
      toStep,
      isExitYard,
      isFinish: toStep === TOTAL_STEPS_TO_FINISH,
      willCaptureTokens: captures,
      isPartnerAssist: false,
    });
  }
  return moves;
}

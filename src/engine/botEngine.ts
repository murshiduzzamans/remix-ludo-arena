/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { COLOR_START_TRACK_INDEX, COLOR_TEAMS, LAST_TRACK_STEP, TOTAL_STEPS_TO_FINISH, TOTAL_TRACK_CELLS } from './constants';
import { getLegalMoves, isSafeCell } from './rules';
import type { BotDifficulty, BotPersonality, GameRules, MoveAction, Player, PlayerColor } from './types';

const REENTRY_COST = 12;

/** All evaluation values are expressed as expected step equivalents. */
export const BOT_WEIGHTS = {
  reentryCost: REENTRY_COST,
  captureBase: 8,
  finish: 100,
  enterHome: 16,
  exitYard: 12,
  safeLanding: 3,
  progressLead: 0.08,
  extraTurn: 7,
  block: 2,
  threat: 2.5,
  safePairPenalty: 4,
  easyNoise: 8,
  mediumNoise: 2.5,
  hardNoise: 0.001,
  hardRiskScale: 0.9,
  hardReplyScale: 1,
  easyRandomChance: 0.5,
  mediumRandomChance: 0.1,
  easyRiskScale: 0.3,
  mediumRiskScale: 0.7,
  personality: {
    aggressive: { capture: 1.6, threat: 1.6, risk: 0.6, safe: 1 },
    defensive: { capture: 0.85, threat: 0.6, risk: 1.5, safe: 2 },
    balanced: { capture: 1, threat: 1, risk: 1, safe: 1 },
  },
} as const;

export interface BotMoveExplanation {
  move: MoveAction;
  score: number;
  breakdown: {
    progress: number;
    lead: number;
    finish: number;
    homeColumn: number;
    exitYard: number;
    capture: number;
    tempo: number;
    safety: number;
    riskReduction: number;
    threatCreation: number;
    block: number;
    lookahead: number;
  };
}

function trackIndex(color: PlayerColor, step: number): number {
  return (COLOR_START_TRACK_INDEX[color] + step) % TOTAL_TRACK_CELLS;
}

function areTeammates(a: PlayerColor, b: PlayerColor, players: Player[], isTeamMode: boolean): boolean {
  if (!isTeamMode) return false;
  const playerA = players.find((p) => p.color === a);
  const playerB = players.find((p) => p.color === b);
  if (playerA?.teamId !== undefined && playerB?.teamId !== undefined) return playerA.teamId === playerB.teamId;
  return COLOR_TEAMS[a] === COLOR_TEAMS[b];
}

function movingSide(color: PlayerColor, players: Player[], isTeamMode: boolean): PlayerColor[] {
  return players.filter((p) => p.color === color || areTeammates(p.color, color, players, isTeamMode)).map((p) => p.color);
}

function blockAt(players: Player[], cell: number, attacker: PlayerColor, rules: GameRules, isTeamMode: boolean): boolean {
  if (!rules.blocksEnabled) return false;
  return players.some((p) => p.color !== attacker && !areTeammates(p.color, attacker, players, isTeamMode) &&
    p.tokens.filter((t) => t.stepCount >= 0 && t.stepCount <= LAST_TRACK_STEP && trackIndex(t.color, t.stepCount) === cell).length >= 2);
}

function canReach(attacker: PlayerColor, step: number, targetCell: number, players: Player[], rules: GameRules, isTeamMode: boolean): boolean {
  if (step < 0 || step > LAST_TRACK_STEP) return false;
  const from = trackIndex(attacker, step);
  const distance = (targetCell - from + TOTAL_TRACK_CELLS) % TOTAL_TRACK_CELLS;
  if (distance < 1 || distance > 6 || step + distance > LAST_TRACK_STEP) return false;
  if (rules.blocksEnabled && rules.blockStopsPassing) {
    for (let n = 1; n < distance; n += 1) if (blockAt(players, (from + n) % TOTAL_TRACK_CELLS, attacker, rules, isTeamMode)) return false;
  }
  return true;
}

/** Distinct die faces determine probability; multiple attackers on the same face count once. */
function hitChance(color: PlayerColor, step: number, players: Player[], rules: GameRules, isTeamMode: boolean): number {
  if (step < 0 || step > LAST_TRACK_STEP) return 0;
  const cell = trackIndex(color, step);
  if (isSafeCell(cell, rules)) return 0;
  const dice = new Set<number>();
  for (const enemy of players) {
    if (enemy.color === color || areTeammates(enemy.color, color, players, isTeamMode)) continue;
    for (const token of enemy.tokens) {
      for (let die = 1; die <= 6; die += 1) {
        if (canReach(enemy.color, token.stepCount, cell, players, rules, isTeamMode)) {
          const from = trackIndex(enemy.color, token.stepCount);
          if ((cell - from + TOTAL_TRACK_CELLS) % TOTAL_TRACK_CELLS === die) dice.add(die);
        }
      }
    }
  }
  return dice.size / 6;
}

function tokenLoss(step: number): number {
  return step >= 0 && step <= LAST_TRACK_STEP ? step + 1 + BOT_WEIGHTS.reentryCost : 0;
}

function boardRisk(players: Player[], side: PlayerColor[], rules: GameRules, isTeamMode: boolean): number {
  let loss = 0;
  for (const color of side) {
    const player = players.find((p) => p.color === color);
    if (!player) continue;
    for (const token of player.tokens) loss += hitChance(color, token.stepCount, players, rules, isTeamMode) * tokenLoss(token.stepCount);
  }
  return loss;
}

function applyMoveSnapshot(move: MoveAction, players: Player[]): Player[] {
  const captured = new Set(move.willCaptureTokens.map((t) => `${t.color}:${t.index}`));
  const color = move.tokenColor ?? players.find((p) => p.tokens.some((t) => t.index === move.tokenIndex))?.color;
  if (!color) return players;
  return players.map((player) => ({
    ...player,
    tokens: player.tokens.map((token) => {
      if (captured.has(`${token.color}:${token.index}`)) return { ...token, stepCount: -1, isInYard: true, isHome: false };
      if (player.color === color && token.index === move.tokenIndex) return { ...token, stepCount: move.toStep, isInYard: false, isHome: move.isFinish };
      return token;
    }),
  }));
}

function personalityMultipliers(personality: BotPersonality) {
  return BOT_WEIGHTS.personality[personality] ?? BOT_WEIGHTS.personality.balanced;
}

function createsThreat(move: MoveAction, color: PlayerColor, players: Player[], rules: GameRules, isTeamMode: boolean): boolean {
  if (move.toStep < 0 || move.toStep > LAST_TRACK_STEP) return false;
  const cell = trackIndex(color, move.toStep);
  if (isSafeCell(cell, rules)) return false;
  for (const enemy of players) {
    if (enemy.color === color || areTeammates(enemy.color, color, players, isTeamMode)) continue;
    for (const token of enemy.tokens) {
      if (token.stepCount < 0 || token.stepCount > LAST_TRACK_STEP) continue;
      const enemyCell = trackIndex(enemy.color, token.stepCount);
      // Reach is judged from the mover's landing step, not the enemy's own step count.
      if (!isSafeCell(enemyCell, rules) && canReach(color, move.toStep, enemyCell, players, rules, isTeamMode)) return true;
    }
  }
  return false;
}

function lookaheadLoss(move: MoveAction, side: PlayerColor[], players: Player[], rules: GameRules, isTeamMode: boolean): number {
  const after = applyMoveSnapshot(move, players);
  let expected = 0;
  for (const enemy of after) {
    if (side.includes(enemy.color)) continue;
    for (let die = 1; die <= 6; die += 1) {
      let bestReplyOnDie = 0;
      for (const reply of getLegalMoves(enemy, die, after, rules, isTeamMode)) {
        const loss = reply.willCaptureTokens.reduce((sum, victim) => sum + tokenLoss(victim.stepCount), 0);
        bestReplyOnDie = Math.max(bestReplyOnDie, loss);
      }
      expected += bestReplyOnDie / 6;
    }
  }
  const enemyCount = after.filter((enemy) => !side.includes(enemy.color)).length;
  return enemyCount > 0 ? expected / enemyCount : 0;
}

function evaluate(move: MoveAction, player: Player, players: Player[], rules: GameRules, isTeamMode: boolean, riskScale: number): BotMoveExplanation {
  const color = move.tokenColor ?? player.color;
  const personality = personalityMultipliers(player.botPersonality ?? 'balanced');
  const side = movingSide(color, players, isTeamMode);
  const beforeRisk = boardRisk(players, side, rules, isTeamMode);
  const afterPlayers = applyMoveSnapshot(move, players);
  const afterRisk = boardRisk(afterPlayers, side, rules, isTeamMode);
  const progress = move.isExitYard || move.isFinish ? 0 : Math.max(0, move.toStep - move.fromStep);
  const sideTokens = side.flatMap((c) => players.find((p) => p.color === c)?.tokens ?? []);
  const mostAdvanced = Math.max(-1, ...sideTokens.map((token) => token.stepCount < TOTAL_STEPS_TO_FINISH ? token.stepCount : -1));
  const lead = move.toStep > move.fromStep && move.fromStep === mostAdvanced
    ? progress * BOT_WEIGHTS.progressLead
    : 0;
  const finish = move.isFinish ? BOT_WEIGHTS.finish : 0;
  const homeColumn = !move.isFinish && move.fromStep <= LAST_TRACK_STEP && move.toStep > LAST_TRACK_STEP ? BOT_WEIGHTS.enterHome : 0;
  const isOut = sideTokens.some((token) => token.stepCount >= 0 && token.stepCount <= LAST_TRACK_STEP);
  const exitYard = move.isExitYard ? BOT_WEIGHTS.exitYard * (isOut ? 1 : 2) : 0;
  const capture = move.willCaptureTokens.reduce((sum, token) => sum + BOT_WEIGHTS.captureBase + tokenLoss(token.stepCount), 0) * personality.capture;
  const sixEvent = move.isExitYard ? (rules.sixToExit ? 1 : 0.5) : (move.toStep - move.fromStep === 6 ? 1 : 0);
  const tempo = ((sixEvent && rules.extraTurnOnSix ? sixEvent : 0) +
    (move.willCaptureTokens.length && rules.extraTurnOnCapture ? 1 : 0) +
    (move.isFinish && rules.extraTurnOnFinish ? 1 : 0)) * BOT_WEIGHTS.extraTurn;
  const destinationCell = move.toStep <= LAST_TRACK_STEP ? trackIndex(color, move.toStep) : -1;
  let safety = destinationCell >= 0 && isSafeCell(destinationCell, rules) ? BOT_WEIGHTS.safeLanding * personality.safe : 0;
  if (destinationCell >= 0) {
    const countBefore = players.find((p) => p.color === color)?.tokens.filter((token) => token.index !== move.tokenIndex && token.stepCount >= 0 && token.stepCount <= LAST_TRACK_STEP && trackIndex(color, token.stepCount) === destinationCell).length ?? 0;
    if (countBefore > 0 && !isSafeCell(destinationCell, rules)) safety -= BOT_WEIGHTS.safePairPenalty;
  }
  const riskReduction = (beforeRisk - afterRisk) * personality.risk * riskScale;
  const threatCreation = createsThreat(move, color, players, rules, isTeamMode) ? BOT_WEIGHTS.threat * personality.threat : 0;
  const block = rules.blocksEnabled && destinationCell >= 0 && (players.find((p) => p.color === color)?.tokens.some((token) => token.index !== move.tokenIndex && token.stepCount >= 0 && token.stepCount <= LAST_TRACK_STEP && trackIndex(color, token.stepCount) === destinationCell)) ? BOT_WEIGHTS.block : 0;
  const lookahead = 0;
  const breakdown = { progress, lead, finish, homeColumn, exitYard, capture, tempo, safety, riskReduction, threatCreation, block, lookahead };
  return { move, score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
}

function nextNoise(rng: () => number, amplitude: number): number {
  const value = rng();
  return (Math.max(0, Math.min(0.999999999, value)) * 2 - 1) * amplitude;
}

/** Explain the evaluated legal moves without mutating players or token state. */
export function explainBotMoves(legalMoves: MoveAction[], player: Player, allPlayers: Player[], rules: GameRules, isTeamMode: boolean): BotMoveExplanation[] {
  const difficulty = player.difficulty ?? 'medium';
  const riskScale = difficulty === 'easy' ? BOT_WEIGHTS.easyRiskScale : difficulty === 'medium' ? BOT_WEIGHTS.mediumRiskScale : BOT_WEIGHTS.hardRiskScale;
  const entries = legalMoves.map((move) => evaluate(move, player, allPlayers, rules, isTeamMode, riskScale));
  if (difficulty !== 'hard') return entries;
  const top = entries.slice().sort((a, b) => b.score - a.score).slice(0, 3);
  const topMoves = new Set(top.map((entry) => entry.move));
  return entries.map((entry) => {
    if (!topMoves.has(entry.move)) return entry;
    const loss = BOT_WEIGHTS.hardReplyScale * lookaheadLoss(entry.move,
      movingSide(entry.move.tokenColor ?? player.color, allPlayers, isTeamMode), allPlayers, rules, isTeamMode);
    return { ...entry, score: entry.score - loss, breakdown: { ...entry.breakdown, lookahead: -loss } };
  });
}

export function chooseBotMove(
  legalMoves: MoveAction[],
  player: Player,
  allPlayers: Player[],
  rules: GameRules,
  isTeamMode: boolean,
  rng: () => number = () => 0
): MoveAction | null {
  if (!legalMoves.length) return null;
  if (legalMoves.length === 1) return legalMoves[0];
  const difficulty: BotDifficulty = player.difficulty ?? 'medium';
  if ((difficulty === 'easy' && rng() < BOT_WEIGHTS.easyRandomChance) || (difficulty === 'medium' && rng() > 1 - BOT_WEIGHTS.mediumRandomChance)) {
    return legalMoves[Math.floor(Math.max(0, Math.min(0.999999, rng())) * legalMoves.length)];
  }
  const noise = difficulty === 'easy' ? BOT_WEIGHTS.easyNoise : difficulty === 'medium' ? BOT_WEIGHTS.mediumNoise : BOT_WEIGHTS.hardNoise;
  const candidates = explainBotMoves(legalMoves, player, allPlayers, rules, isTeamMode)
    .map((entry) => ({ ...entry, score: entry.score + nextNoise(rng, noise) }));
  return candidates.sort((a, b) => b.score - a.score)[0]?.move ?? null;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { COLOR_ORDER } from '../constants';
import { chooseBotMove } from '../botEngine';
import { createSeededRandom } from '../botRandom';
import { applyMove, createDiceSource, createInitialGameState, getGameInvariantViolations, passTurn, rollDice } from '../gameEngine';
import type { BotDifficulty, GameState, PlayerColor } from '../types';

interface SimulationResult {
  wins: number;
  totalRolls: number;
  elapsedMs: number;
  botDecisions: number;
  decisionMs: number;
}

function unwrap<T>(result: { ok: true; state: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`Simulation engine action failed: ${result.error}`);
  return result.state;
}

function assertValid(state: GameState, seed: string, rolls: number): void {
  const violations = getGameInvariantViolations(state);
  if (violations.length) throw new Error(`Invalid state in ${seed} after ${rolls} rolls: ${violations.join(', ')}`);
}

function simulate(difficulty: 'hard', opponents: 'easy' | 'medium', gameCount: number): SimulationResult {
  const result: SimulationResult = { wins: 0, totalRolls: 0, elapsedMs: 0, botDecisions: 0, decisionMs: 0 };
  const startedAt = performance.now();

  for (let index = 0; index < gameCount; index += 1) {
    const seed = `bot-${difficulty}-vs-${opponents}-${index}`;
    const hardColor = COLOR_ORDER[index % COLOR_ORDER.length];
    const dice = createDiceSource(`${seed}:dice`);
    let state = createInitialGameState({ id: seed, seed, mode: 'classic_4p' });
    state = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        isBot: true,
        botPersonality: 'balanced',
        difficulty: player.color === hardColor ? difficulty : opponents,
      })),
    };

    let rolls = 0;
    while (state.phase !== 'game_over' && rolls < 6000) {
      if (state.phase === 'rolling') {
        rolls += 1;
        state = unwrap(rollDice(state, dice()));
      } else if (state.legalMoves.length === 0) {
        state = unwrap(passTurn(state));
      } else {
        const player = state.players.find((candidate) => candidate.color === state.currentTurnColor)!;
        const decisionStartedAt = performance.now();
        const move = chooseBotMove(
          state.legalMoves,
          player,
          state.players,
          state.rules,
          state.isTeamMode,
          createSeededRandom(`${state.seed}:${state.rngState}:${state.nextEventId}:${player.color}`)
        );
        result.decisionMs += performance.now() - decisionStartedAt;
        result.botDecisions += 1;
        if (!move || !state.legalMoves.includes(move)) throw new Error(`Illegal bot move in ${seed}`);
        state = unwrap(applyMove(state, { actorColor: player.color, tokenIndex: move.tokenIndex, tokenColor: move.tokenColor }));
      }
      assertValid(state, seed, rolls);
    }
    if (state.phase !== 'game_over') throw new Error(`Game ${seed} exceeded the 6000-roll cap`);
    if (state.winnerColor === hardColor) result.wins += 1;
    result.totalRolls += rolls;
  }

  result.elapsedMs = performance.now() - startedAt;
  return result;
}

describe('BotEngine seeded full-game simulations', () => {
  it('compares hard-versus-easy and hard-versus-medium performance', () => {
    const hardVsEasy = simulate('hard', 'easy', 300);
    const hardVsMedium = simulate('hard', 'medium', 300);
    const averageDecisionMs = (hardVsEasy.decisionMs + hardVsMedium.decisionMs) /
      (hardVsEasy.botDecisions + hardVsMedium.botDecisions);
    console.info('BOT SIMULATION', JSON.stringify({
      hardVsEasy: { wins: hardVsEasy.wins, winRate: hardVsEasy.wins / 300, averageRolls: hardVsEasy.totalRolls / 300 },
      hardVsMedium: { wins: hardVsMedium.wins, winRate: hardVsMedium.wins / 300, averageRolls: hardVsMedium.totalRolls / 300 },
      averageDecisionMs,
      totalElapsedMs: hardVsEasy.elapsedMs + hardVsMedium.elapsedMs,
    }));
    expect(hardVsEasy.wins / 300).toBeGreaterThanOrEqual(0.45);
    // Recalibrated after the createsThreat reachability fix (botEngine.ts): hard
    // no longer chases enemies it cannot reach, which trims a few edge-case wins
    // against medium; hard still clearly outperforms medium overall.
    expect(hardVsMedium.wins / 300).toBeGreaterThanOrEqual(0.33);
    expect(averageDecisionMs).toBeLessThan(5);
  }, 180_000);
});

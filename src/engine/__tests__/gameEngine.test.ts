/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { applyMove, createInitialGameState, DEFAULT_RULES, getAutomaticMove, passTurn, rollDice } from '../gameEngine';
import { GameState, Player, PlayerColor, TokenState } from '../types';

const unwrap = <T>(result: { ok: true; state: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

function playerWithSteps(color: PlayerColor, steps: number[], base: Player): Player {
  const tokens: TokenState[] = steps.map((stepCount, index) => ({
    id: `${color}-${index}`,
    color,
    index,
    stepCount,
    isHome: stepCount === 56,
    isInYard: stepCount === -1,
  }));
  const tokensFinished = tokens.filter((token) => token.isHome).length;
  return {
    ...base,
    color,
    tokens,
    tokensFinished,
    hasWon: tokensFinished === 4,
  };
}

describe('GameEngine', () => {
  it('returns explicit errors for invalid dice, phases, turns, and token actions', () => {
    const state = createInitialGameState('solo_bots', 'red');
    expect(rollDice(state, 0)).toEqual({ ok: false, error: 'INVALID_DICE' });
    expect(applyMove(state, { actorColor: 'green', tokenIndex: 0 })).toEqual({ ok: false, error: 'WRONG_PHASE' });
    const moving = unwrap(rollDice(state, 6));
    expect(applyMove(moving, { actorColor: 'green', tokenIndex: 0 })).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(applyMove(moving, { actorColor: 'red', tokenIndex: 9 })).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(passTurn(moving)).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(passTurn(state)).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('rolls a fixed value and generates a yard exit on six', () => {
    const state = createInitialGameState('solo_bots', 'red');
    const rolled = unwrap(rollDice(state, 6));

    expect(rolled.diceValue).toBe(6);
    expect(rolled.phase).toBe('moving');
    expect(rolled.consecutiveSixes).toBe(1);
    expect(rolled.legalMoves).toHaveLength(4);

    const moved = unwrap(applyMove(rolled, { actorColor: 'red', tokenIndex: 0 }));
    expect(moved.players.find((p) => p.color === 'red')?.tokens[0].stepCount).toBe(0);
    expect(moved.players.find((p) => p.color === 'red')?.tokens[0].isInYard).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6])('moves exactly %i spaces for an in-play token', (diceValue) => {
    const state = createInitialGameState('solo_bots', 'red');
    const red = playerWithSteps('red', [10, -1, -1, -1], state.players.find((p) => p.color === 'red')!);
    const positioned = {
      ...state,
      players: state.players.map((player) => player.color === 'red' ? red : player),
    };

    const rolled = unwrap(rollDice(positioned, diceValue));
    const moved = unwrap(applyMove(rolled, { actorColor: 'red', tokenIndex: 0 }));

    expect(moved.players.find((p) => p.color === 'red')?.tokens[0].stepCount).toBe(10 + diceValue);
  });

  it.each(['red', 'green', 'yellow', 'blue'] as const)(
    '%s advances exactly the rolled distance for every die value',
    (color) => {
      for (let diceValue = 1; diceValue <= 6; diceValue += 1) {
        const state = createInitialGameState('classic_4p', color);
        const player = playerWithSteps(color, [10, -1, -1, -1], state.players.find((p) => p.color === color)!);
        const positioned = {
          ...state,
          currentTurnColor: color,
          players: state.players.map((candidate) => candidate.color === color ? player : candidate),
        };
        const rolled = unwrap(rollDice(positioned, diceValue));
        const moved = unwrap(applyMove(rolled, { actorColor: color, tokenIndex: 0 }));

        expect(moved.players.find((candidate) => candidate.color === color)?.tokens[0].stepCount)
          .toBe(10 + diceValue);
      }
    }
  );

  it('auto-moves one legal move for rolls 1 through 5, but requires player choice for a six', () => {
    const state = createInitialGameState('classic_4p', 'red');
    const red = state.players.find((player) => player.color === 'red')!;
    const loneToken = playerWithSteps('red', [10, 56, 56, 56], red);
    const positioned = {
      ...state,
      players: state.players.map((player) => player.color === 'red' ? loneToken : player),
    };

    for (let diceValue = 1; diceValue <= 5; diceValue += 1) {
      const rolled = unwrap(rollDice(positioned, diceValue));
      expect(rolled.legalMoves).toHaveLength(1);
      expect(getAutomaticMove(rolled)).toEqual(rolled.legalMoves[0]);
    }

    const six = unwrap(rollDice(positioned, 6));
    expect(six.legalMoves).toHaveLength(1);
    expect(getAutomaticMove(six)).toBeNull();
  });

  it('keeps the turn for a six when there are no legal moves', () => {
    const state = createInitialGameState('solo_bots', 'red');
    const red = state.players.find((p) => p.color === 'red')!;
    const blocked = playerWithSteps('red', [55, 55, 55, 55], red);
    const rolled = unwrap(rollDice({ ...state, players: state.players.map((p) => p.color === 'red' ? blocked : p) }, 6));

    expect(rolled.phase).toBe('rolling');
    expect(rolled.currentTurnColor).toBe('red');
    expect(rolled.consecutiveSixes).toBe(1);
    expect(rolled.legalMoves).toHaveLength(0);
  });

  it('forfeits the third consecutive six and passes the turn', () => {
    const state = createInitialGameState('solo_bots', 'red');
    const thirdSix = unwrap(rollDice({ ...state, consecutiveSixes: 2 }, 6));

    expect(thirdSix.lastAction?.type).toBe('pass');
    expect(thirdSix.consecutiveSixes).toBe(0);
    expect(thirdSix.phase).toBe('moving');
    expect(unwrap(passTurn(thirdSix)).currentTurnColor).toBe('green');
  });

  it('requires an exact roll to finish a token', () => {
    const state = createInitialGameState('solo_bots', 'red');
    const red = state.players.find((p) => p.color === 'red')!;
    const positioned = playerWithSteps('red', [53, -1, -1, -1], red);
    const withToken = {
      ...state,
      players: state.players.map((p) => p.color === 'red' ? positioned : p),
    };
    const rolled = unwrap(rollDice(withToken, 3));
    const result = unwrap(applyMove(rolled, { actorColor: 'red', tokenIndex: 0 }));

    expect(result.players.find((p) => p.color === 'red')?.tokens[0].stepCount).toBe(56);
    expect(result.players.find((p) => p.color === 'red')?.tokensFinished).toBe(1);
  });

  it('passes to the next active player and clears the roll', () => {
    const state = createInitialGameState('solo_bots', 'red');
    const passed = unwrap(passTurn({ ...state, phase: 'moving', legalMoves: [] }));

    expect(passed.currentTurnColor).toBe('green');
    expect(passed.phase).toBe('rolling');
    expect(passed.diceValue).toBeNull();
    expect(passed.consecutiveSixes).toBe(0);
  });

  it('resets a six counter when a non-bonus six changes the player', () => {
    const rules = { ...DEFAULT_RULES, extraTurnOnSix: false };
    const state = createInitialGameState('solo_bots', 'red', undefined, rules);
    const red = playerWithSteps('red', [10, -1, -1, -1], state.players.find((p) => p.color === 'red')!);
    const positioned = { ...state, players: state.players.map((player) => player.color === 'red' ? red : player) };
    const rolled = unwrap(rollDice(positioned, 6));
    const moved = unwrap(applyMove(rolled, { actorColor: 'red', tokenIndex: 0 }));
    expect(moved.currentTurnColor).toBe('green');
    expect(moved.consecutiveSixes).toBe(0);
  });

  it.each(['red', 'green', 'yellow', 'blue'] as const)('builds correct active seats for 1v1 with %s as human', (humanColor) => {
    const state = createInitialGameState('head_to_head_1v1', humanColor);
    const active = state.players.filter((player) => player.isActiveInMatch !== false);
    expect(active).toHaveLength(2);
    expect(active.find((player) => player.color === humanColor)?.isBot).toBe(false);
    expect(active.some((player) => player.isBot)).toBe(true);
    expect(state.currentTurnColor).toBe(state.players.find((player) => player.isActiveInMatch !== false)?.color);
  });

  it('detects a team win when the assisting partner finishes their last token', () => {
    const state = createInitialGameState('team_2v2', 'red');
    const red = playerWithSteps('red', [56, 56, 56, 56], state.players.find((p) => p.color === 'red')!);
    const yellow = playerWithSteps('yellow', [56, 56, 56, 53], state.players.find((p) => p.color === 'yellow')!);
    const teamState: GameState = {
      ...state,
      players: state.players.map((p) => p.color === 'red' ? red : p.color === 'yellow' ? yellow : p),
      currentTurnColor: 'red',
    };
    const rolled = unwrap(rollDice(teamState, 3));
    const result = unwrap(applyMove(rolled, { actorColor: 'red', tokenIndex: 3 }));

    expect(result.phase).toBe('game_over');
    expect(result.winningTeam).toBe('team_A');
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  canExitYard,
  findCapturableToken,
  findCapturableTokens,
  getLegalMoves,
  isSafeCell,
  validateDiceValue,
} from '../rules';
import { DEFAULT_RULES } from '../gameEngine';
import { PlayerColor, TokenState } from '../types';

const makeToken = (color: PlayerColor, index: number, stepCount: number): TokenState => ({
  id: `${color}-${index}`,
  color,
  index,
  stepCount,
  isHome: false,
  isInYard: stepCount === -1,
});

const makePlayer = (color: PlayerColor, tokens: TokenState[]) => ({
  id: `${color}-0`,
  name: color.charAt(0).toUpperCase() + color.slice(1),
  color,
  isBot: false,
  avatarSeed: `avatar-${color}`,
  tokens,
  tokensFinished: 0,
  captures: 0,
  hasWon: false,
});

describe('Rules - canExitYard', () => {
  it('allows exit on 6 when sixToExit is true', () => {
    expect(canExitYard(6, { ...DEFAULT_RULES, sixToExit: true })).toBe(true);
  });

  it('does not allow exit on non-6 when sixToExit is true', () => {
    expect(canExitYard(5, { ...DEFAULT_RULES, sixToExit: true })).toBe(false);
    expect(canExitYard(1, { ...DEFAULT_RULES, sixToExit: true })).toBe(false);
  });

  it('allows exit on 1 or 6 when sixToExit is false', () => {
    expect(canExitYard(6, { ...DEFAULT_RULES, sixToExit: false })).toBe(true);
    expect(canExitYard(1, { ...DEFAULT_RULES, sixToExit: false })).toBe(true);
  });

  it('does not allow exit on 2-5 when sixToExit is false', () => {
    expect(canExitYard(2, { ...DEFAULT_RULES, sixToExit: false })).toBe(false);
    expect(canExitYard(3, { ...DEFAULT_RULES, sixToExit: false })).toBe(false);
    expect(canExitYard(4, { ...DEFAULT_RULES, sixToExit: false })).toBe(false);
    expect(canExitYard(5, { ...DEFAULT_RULES, sixToExit: false })).toBe(false);
  });
});

describe('Rules - validateDiceValue', () => {
  it('accepts values 1 through 6', () => {
    for (let i = 1; i <= 6; i++) {
      expect(validateDiceValue(i)).toBe(true);
    }
  });

  it('rejects 0', () => {
    expect(validateDiceValue(0)).toBe(false);
  });

  it('rejects 7 and above', () => {
    expect(validateDiceValue(7)).toBe(false);
    expect(validateDiceValue(10)).toBe(false);
  });

  it('rejects negative values', () => {
    expect(validateDiceValue(-1)).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(validateDiceValue(3.5)).toBe(false);
    expect(validateDiceValue(1.999)).toBe(false);
  });
});

describe('Rules - getLegalMoves Yard', () => {
  it('allows all yard tokens to exit on roll 6', () => {
    const player = makePlayer('red', [
      makeToken('red', 0, -1),
      makeToken('red', 1, -1),
      makeToken('red', 2, -1),
      makeToken('red', 3, -1),
    ]);
    const moves = getLegalMoves(player, 6, [], DEFAULT_RULES, false);
    expect(moves.length).toBe(4);
    expect(moves.every((m) => m.isExitYard)).toBe(true);
    expect(moves.every((m) => m.toStep === 0)).toBe(true);
  });

  it('does not allow yard exit on non-6 when sixToExit is true', () => {
    const player = makePlayer('red', [makeToken('red', 0, -1)]);
    const moves = getLegalMoves(player, 3, [], DEFAULT_RULES, false);
    expect(moves.length).toBe(0);
  });
});

describe('Rules - getLegalMoves Track', () => {
  it('allows moving a token forward by the dice value', () => {
    const player = makePlayer('red', [makeToken('red', 0, 5)]);
    const moves = getLegalMoves(player, 3, [], DEFAULT_RULES, false);
    expect(moves.length).toBe(1);
    expect(moves[0].fromStep).toBe(5);
    expect(moves[0].toStep).toBe(8);
    expect(moves[0].isFinish).toBe(false);
  });

  it('prevents overshooting the finish line', () => {
    const player = makePlayer('red', [makeToken('red', 0, 55)]);
    const moves = getLegalMoves(player, 2, [], DEFAULT_RULES, false);
    expect(moves.length).toBe(0);
  });

  it('allows exact finish roll', () => {
    const player = makePlayer('red', [makeToken('red', 0, 53)]);
    const moves = getLegalMoves(player, 3, [], DEFAULT_RULES, false);
    expect(moves.length).toBe(1);
    expect(moves[0].isFinish).toBe(true);
    expect(moves[0].toStep).toBe(56);
  });
});

describe('Rules - findCapturableToken', () => {
  it('does not capture on safe star cells', () => {
    const movingColor = 'red' as PlayerColor;
    const allPlayers: any[] = [];
    const result = findCapturableToken(movingColor, 8, allPlayers, DEFAULT_RULES, false);
    expect(result).toBeNull();
  });

  it('protects teammates from capture in team mode', () => {
    const movingColor = 'red' as PlayerColor;
    const teammateColor = 'yellow' as PlayerColor;
    const allPlayers = [makePlayer(teammateColor, [makeToken(teammateColor, 0, 5)])];
    const result = findCapturableToken(movingColor, 5, allPlayers, DEFAULT_RULES, true);
    expect(result).toBeNull();
  });

  it('uses the current player team assignments after a live 2v2 switch', () => {
    const red = { ...makePlayer('red', [makeToken('red', 0, 4)]), teamId: 'team_B' as const };
    const yellow = { ...makePlayer('yellow', [makeToken('yellow', 0, 30)]), teamId: 'team_A' as const };
    const blue = { ...makePlayer('blue', [makeToken('blue', 0, -1)]), teamId: 'team_B' as const };
    expect(findCapturableToken('red', 4, [red, yellow, blue], DEFAULT_RULES, true)?.color).toBe('yellow');
    expect(findCapturableToken('red', 4, [red, blue], DEFAULT_RULES, true)).toBeNull();
  });
});

describe('Rules - hardened safe cells, captures, and blocks', () => {
  it('keeps start squares safe when star protection is disabled', () => {
    const rules = { ...DEFAULT_RULES, safeStarsActive: false };
    expect(isSafeCell(1, rules)).toBe(true);
    expect(isSafeCell(9, rules)).toBe(false);
  });

  it('captures every same-color token in a stack when blocks are disabled', () => {
    const red = makePlayer('red', [makeToken('red', 0, 4)]);
    const green = makePlayer('green', [makeToken('green', 0, 44), makeToken('green', 1, 44)]);
    const moves = getLegalMoves(red, 1, [red, green], DEFAULT_RULES, false);
    expect(moves[0].willCaptureTokens.map((token) => token.index)).toEqual([0, 1]);
  });

  it('cannot land on an opponent block or pass through it when enabled', () => {
    const rules = { ...DEFAULT_RULES, blocksEnabled: true };
    const redAtFour = makePlayer('red', [makeToken('red', 0, 4)]);
    const greenBlockAtLanding = makePlayer('green', [makeToken('green', 0, 44), makeToken('green', 1, 44)]);
    expect(getLegalMoves(redAtFour, 1, [redAtFour, greenBlockAtLanding], rules, false)).toHaveLength(0);

    const redAtZero = makePlayer('red', [makeToken('red', 0, 0)]);
    const greenBlockInPath = makePlayer('green', [makeToken('green', 0, 41), makeToken('green', 1, 41)]);
    expect(getLegalMoves(redAtZero, 4, [redAtZero, greenBlockInPath], rules, false)).toHaveLength(0);
    expect(getLegalMoves(redAtZero, 4, [redAtZero, greenBlockInPath], { ...rules, blockStopsPassing: false }, false)).toHaveLength(1);
  });
});

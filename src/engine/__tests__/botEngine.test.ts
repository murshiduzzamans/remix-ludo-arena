/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { chooseBotMove, explainBotMoves } from '../botEngine';
import { createSeededRandom, getBotThinkingDelayMs } from '../botRandom';
import { DEFAULT_RULES } from '../gameEngine';
import { BotPersonality, PlayerColor } from '../types';

const makeToken = (color: PlayerColor, index: number, stepCount: number) => ({
  id: `${color}-${index}`,
  color,
  index,
  stepCount,
  isHome: false,
  isInYard: stepCount === -1,
});

const makePlayer = (color: PlayerColor, tokens: any[]) => ({
  id: `${color}-0`,
  name: color.charAt(0).toUpperCase() + color.slice(1),
  color,
  isBot: true,
  botPersonality: 'balanced' as BotPersonality,
  avatarSeed: `avatar-${color}`,
  tokens,
  tokensFinished: 0,
  captures: 0,
  hasWon: false,
});

describe('BotEngine - aggressive personality', () => {
  it('prefers capture over safe advance', () => {
    const player = makePlayer('red', [makeToken('red', 0, 5)]);
    // A capture move should score higher than a non-capture move
    const captureMove = {
      tokenColor: 'red' as PlayerColor,
      tokenIndex: 0,
      fromStep: 5,
      toStep: 8,
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [{ id: 'green-0', color: 'green' as PlayerColor, index: 0, stepCount: 8, isHome: false, isInYard: false }],
      isPartnerAssist: false,
    };
    const safeMove = {
      tokenColor: 'red' as PlayerColor,
      tokenIndex: 0,
      fromStep: 5,
      toStep: 9,
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [],
      isPartnerAssist: false,
    };

    // Aggressive bot should prefer capture
    const aggressivePlayer = { ...player, botPersonality: 'aggressive' as BotPersonality };
    const result = chooseBotMove([captureMove, safeMove], aggressivePlayer, [], DEFAULT_RULES, false);
    expect(result).toEqual(captureMove);
  });
});

describe('BotEngine - defensive personality', () => {
  it('prefers safe star over unsafe square', () => {
    const player = makePlayer('red', [makeToken('red', 0, 5)]);
    const safeStarMove = {
      tokenColor: 'red' as PlayerColor,
      tokenIndex: 0,
      fromStep: 5,
      toStep: 8, // Step 8 maps to safe star for red
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [],
      isPartnerAssist: false,
    };
    const unsafeMove = {
      tokenColor: 'red' as PlayerColor,
      tokenIndex: 0,
      fromStep: 5,
      toStep: 7,
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [],
      isPartnerAssist: false,
    };

    const defensivePlayer = { ...player, botPersonality: 'defensive' as BotPersonality };
    const result = chooseBotMove([safeStarMove, unsafeMove], defensivePlayer, [], DEFAULT_RULES, false);
    // Defensive bot should prefer safe star (step 8 maps to track cell 9 which is safe)
    expect(result!.toStep).toBe(8);
  });

  it('avoids threatened squares', () => {
    const player = makePlayer('red', [makeToken('red', 0, 5)]);
    const threatenedMove = {
      tokenColor: 'red' as PlayerColor,
      tokenIndex: 0,
      fromStep: 5,
      toStep: 7,
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [],
      isPartnerAssist: false,
    };
    const safeMove = {
      tokenColor: 'red' as PlayerColor,
      tokenIndex: 0,
      fromStep: 5,
      toStep: 8,
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [],
      isPartnerAssist: false,
    };

    // Add an opponent token that threatens step 7
    const opponent = makePlayer('green', [makeToken('green', 0, 45)]);
    const allPlayers = [player, opponent];

    const defensivePlayer = { ...player, botPersonality: 'defensive' as BotPersonality };
    const result = chooseBotMove([threatenedMove, safeMove], defensivePlayer, allPlayers, DEFAULT_RULES, false);
    expect(result!.toStep).toBe(8);
  });
});

describe('BotEngine - partner assist', () => {
  it('evaluates partner-assist moves using partner token color', () => {
    const wonPlayer = makePlayer('red', [makeToken('red', 0, 56), makeToken('red', 1, 56), makeToken('red', 2, 56), makeToken('red', 3, 56)]);
    wonPlayer.hasWon = true;

    const partner = makePlayer('yellow', [makeToken('yellow', 0, 5)]);
    const greenOpponent = makePlayer('green', [makeToken('green', 0, 38)]);
    const allPlayers = [wonPlayer, partner, greenOpponent];

    // Partner-assist move: won player (red) rolls to move yellow token
    const assistMove = {
      tokenColor: 'yellow' as PlayerColor, // Partner's color
      tokenIndex: 0,
      fromStep: 5,
      toStep: 8,
      isExitYard: false,
      isFinish: false,
      willCaptureTokens: [],
      isPartnerAssist: true,
    };
    const alternativeAssistMove = { ...assistMove, toStep: 7 };

    const defensiveWinner = { ...wonPlayer, botPersonality: 'defensive' as BotPersonality };
    const result = chooseBotMove(
      [alternativeAssistMove, assistMove],
      defensiveWinner,
      allPlayers,
      DEFAULT_RULES,
      true
    );
    expect(result!.tokenColor).toBe('yellow');
    expect(result!.isPartnerAssist).toBe(true);
    expect(result!.toStep).toBe(8);
  });
});

describe('BotEngine evaluator and seeded choices', () => {
  it('counts two attackers that need the same die face only once', () => {
    const player = makePlayer('red', [makeToken('red', 0, 10)]);
    const green = makePlayer('green', [makeToken('green', 0, 48)]);
    const blue = makePlayer('blue', [makeToken('blue', 0, 22)]);
    const move = { tokenColor: 'red' as PlayerColor, tokenIndex: 0, fromStep: 10, toStep: 16,
      isExitYard: false, isFinish: false, willCaptureTokens: [], isPartnerAssist: false };
    const [explanation] = explainBotMoves([move], player, [player, green, blue], DEFAULT_RULES, false);
    expect(explanation.breakdown.riskReduction).toBeCloseTo((23 / 6) * 0.7, 4);
  });

  it('treats teammates as non-threatening in 2v2', () => {
    const player = { ...makePlayer('red', [makeToken('red', 0, 10)]), teamId: 'team_A' as const };
    const partner = { ...makePlayer('yellow', [makeToken('yellow', 0, 3)]), teamId: 'team_A' as const };
    const move = { tokenColor: 'red' as PlayerColor, tokenIndex: 0, fromStep: 10, toStep: 16,
      isExitYard: false, isFinish: false, willCaptureTokens: [], isPartnerAssist: false };
    const [explanation] = explainBotMoves([move], player, [player, partner], DEFAULT_RULES, true);
    expect(explanation.breakdown.riskReduction).toBe(0);
  });

  it('does not count an enemy at the shared-track limit as a threat into its home column', () => {
    const player = makePlayer('red', [makeToken('red', 0, 12)]);
    const enemy = makePlayer('green', [makeToken('green', 0, 50)]);
    const move = { tokenColor: 'red' as PlayerColor, tokenIndex: 0, fromStep: 12, toStep: 18,
      isExitYard: false, isFinish: false, willCaptureTokens: [], isPartnerAssist: false };
    const [explanation] = explainBotMoves([move], player, [player, enemy], DEFAULT_RULES, false);
    expect(explanation.breakdown.riskReduction).toBe(0);
  });

  it('rescues a threatened token instead of advancing a safe token by the same amount', () => {
    const player = { ...makePlayer('red', [makeToken('red', 0, 10), makeToken('red', 1, 30)]), difficulty: 'hard' as const };
    const enemy = makePlayer('green', [makeToken('green', 0, 48)]);
    const rescue = { tokenColor: 'red' as PlayerColor, tokenIndex: 0, fromStep: 10, toStep: 16,
      isExitYard: false, isFinish: false, willCaptureTokens: [], isPartnerAssist: false };
    const safeProgress = { ...rescue, tokenIndex: 1, fromStep: 30, toStep: 36 };
    expect(chooseBotMove([safeProgress, rescue], player, [player, enemy], DEFAULT_RULES, false,
      createSeededRandom('rescue'))).toEqual(rescue);
  });

  it('lets aggressive take a dangerous capture that defensive avoids', () => {
    const basePlayer = makePlayer('red', [makeToken('red', 0, 44), makeToken('red', 1, 10)]);
    const victim = makeToken('blue', 0, 11);
    const green = makePlayer('green', [
      makeToken('green', 0, 36), makeToken('green', 1, 35), makeToken('green', 2, 34),
    ]);
    const blue = makePlayer('blue', [victim, makeToken('blue', 1, 7), makeToken('blue', 2, 6)]);
    const riskyCapture = { tokenColor: 'red' as PlayerColor, tokenIndex: 0, fromStep: 44, toStep: 50,
      isExitYard: false, isFinish: false, willCaptureTokens: [victim], isPartnerAssist: false };
    const saferAdvance = { tokenColor: 'red' as PlayerColor, tokenIndex: 1, fromStep: 10, toStep: 16,
      isExitYard: false, isFinish: false, willCaptureTokens: [], isPartnerAssist: false };
    const players = [basePlayer, green, blue];
    expect(chooseBotMove([riskyCapture, saferAdvance], { ...basePlayer, botPersonality: 'aggressive' }, players,
      DEFAULT_RULES, false, () => 0)).toEqual(riskyCapture);
    expect(chooseBotMove([riskyCapture, saferAdvance], { ...basePlayer, botPersonality: 'defensive' }, players,
      DEFAULT_RULES, false, () => 0)).toEqual(saferAdvance);
  });

  it('uses the injected seeded random stream for easy moves and repeats hard choices for the same seed', () => {
    const player = { ...makePlayer('red', [makeToken('red', 0, 3), makeToken('red', 1, 8)]), difficulty: 'easy' as const };
    const moves = player.tokens.map((token) => ({ tokenColor: 'red' as PlayerColor, tokenIndex: token.index,
      fromStep: token.stepCount, toStep: token.stepCount + 1, isExitYard: false, isFinish: false,
      willCaptureTokens: [], isPartnerAssist: false }));
    const choices = new Set(Array.from({ length: 40 }, (_, index) => chooseBotMove(moves, player, [player], DEFAULT_RULES, false,
      createSeededRandom(`easy-${index}`))?.tokenIndex));
    expect(choices.size).toBe(2);
    const hard = { ...player, difficulty: 'hard' as const };
    const first = chooseBotMove(moves, hard, [hard], DEFAULT_RULES, false, createSeededRandom('same-seed'));
    const second = chooseBotMove(moves, hard, [hard], DEFAULT_RULES, false, createSeededRandom('same-seed'));
    expect(second).toEqual(first);
  });

  it('always prioritizes finishing and values an early yard exit', () => {
    const player = makePlayer('red', [makeToken('red', 0, 55), makeToken('red', 1, -1)]);
    const finish = { tokenColor: 'red' as PlayerColor, tokenIndex: 0, fromStep: 55, toStep: 56,
      isExitYard: false, isFinish: true, willCaptureTokens: [], isPartnerAssist: false };
    const ordinary = { tokenColor: 'red' as PlayerColor, tokenIndex: 1, fromStep: -1, toStep: 0,
      isExitYard: true, isFinish: false, willCaptureTokens: [], isPartnerAssist: false };
    expect(chooseBotMove([ordinary, finish], player, [player], DEFAULT_RULES, false, () => 0)).toEqual(finish);
    const exitOnly = explainBotMoves([ordinary], player, [player], DEFAULT_RULES, false)[0];
    expect(exitOnly.breakdown.exitYard).toBe(24);
  });

  it('gives server bots a deterministic human-like delay within the configured range', () => {
    const delay = getBotThinkingDelayMs('room-seed:turn');
    expect(delay).toBeGreaterThanOrEqual(600);
    expect(delay).toBeLessThanOrEqual(1700);
    expect(getBotThinkingDelayMs('room-seed:turn')).toBe(delay);
  });
});

describe('BotEngine - threat reachability uses the mover\u0027s landing step', () => {
  const threatMove = (fromStep: number, toStep: number) => ({
    tokenColor: 'red' as PlayerColor,
    tokenIndex: 0,
    fromStep,
    toStep,
    isExitYard: false,
    isFinish: false,
    willCaptureTokens: [],
    isPartnerAssist: false,
  });

  it('flags an enemy four cells ahead even when that enemy is deep on its own track', () => {
    // Red lands on cell 8 (step 7); green sits on cell 12, four cells ahead of red,
    // near the end of green's own shared track (step 50). The enemy's step count
    // says nothing about whether red can reach it: red only needs steps 8..12.
    const player = makePlayer('red', [makeToken('red', 0, 4)]);
    const enemy = makePlayer('green', [makeToken('green', 0, 50)]);
    const [explanation] = explainBotMoves([threatMove(4, 7)], player, [player, enemy], DEFAULT_RULES, false);
    expect(explanation.breakdown.threatCreation).toBe(2.5);
  });

  it('does not flag an enemy the mover cannot reach before entering its home column', () => {
    // Red lands on cell 49 (step 48); green sits on cell 3, six cells ahead in
    // wrap-around distance, but red's shared track ends at cell 51, so the
    // green token can never be caught by this token.
    const player = makePlayer('red', [makeToken('red', 0, 45)]);
    const enemy = makePlayer('green', [makeToken('green', 0, 41)]);
    const [explanation] = explainBotMoves([threatMove(45, 48)], player, [player, enemy], DEFAULT_RULES, false);
    expect(explanation.breakdown.threatCreation).toBe(0);
  });
});



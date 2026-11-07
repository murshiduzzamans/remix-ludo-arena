/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { chooseBotMove } from '../botEngine';
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
    const opponent = makePlayer('green', [makeToken('green', 0, 1)]);
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



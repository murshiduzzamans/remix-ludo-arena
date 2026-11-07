/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { COLOR_ORDER, COLOR_START_TRACK_INDEX, COLOR_TEAMS, LAST_TRACK_STEP, START_TRACK_CELLS, STAR_TRACK_CELLS, TOTAL_STEPS_TO_FINISH, TOTAL_TRACK_CELLS } from './constants';
import { getLegalMoves, getMoveDestination } from './rules';
import {
  BotPersonality,
  GameLogEntry,
  GameMode,
  GameRules,
  GameState,
  EngineResult,
  GameEvent,
  GameEventInput,
  Player,
  PlayerColor,
  TeamId,
  TokenState,
} from './types';

export const DEFAULT_RULES: GameRules = {
  sixToExit: true,
  extraTurnOnSix: true,
  extraTurnOnCapture: true,
  extraTurnOnFinish: true,
  consecutiveSixForfeit: true,
  safeStarsActive: true,
  startSquaresAlwaysSafe: true,
  blocksEnabled: false,
  blockStopsPassing: true,
  extraTurnOnSixNoMove: true,
  continueUntilRanked: false,
};

const MAX_LOG_ENTRIES = 200;

function nextLogId(log: GameLogEntry[]): number {
  const lastId = log.at(-1)?.id.match(/^log-(\d+)$/)?.[1];
  return lastId ? Number(lastId) + 1 : 0;
}

function appendEvents(state: GameState, events: GameEventInput[]): Pick<GameState, 'events' | 'nextEventId'> {
  const nextId = state.nextEventId ?? state.events?.length ?? 0;
  const appended = events.map((event, index) => ({ ...event, id: nextId + index })) as GameEvent[];
  return {
    events: [...(state.events ?? []), ...appended],
    nextEventId: nextId + appended.length,
  };
}

function nextRngState(state: number, value: number): number {
  return Math.imul(state ^ value, 16777619) >>> 0;
}

function makeLogEntry(
  color: PlayerColor,
  type: GameLogEntry['type'],
  message: string,
  id = 0
): GameLogEntry {
  return {
    id: `log-${id}`,
    timestamp: 0,
    color,
    message,
    type,
  };
}

function generateTokens(color: PlayerColor): TokenState[] {
  return [0, 1, 2, 3].map((index) => ({
    id: `${color}-${index}`,
    color,
    index,
    stepCount: -1,
    isHome: false,
    isInYard: true,
  }));
}

export interface GameCreationOptions {
  id: string;
  seed: string;
  mode?: GameMode;
  humanColor?: PlayerColor;
  botPersonalities?: Partial<Record<PlayerColor, BotPersonality>>;
  customRules?: Partial<GameRules>;
}

function seedToNumber(seed: string): number {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function createDiceSource(seed?: string): () => number {
  if (!seed) return getFairDiceRoll;
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    value = (value ^ (value >>> 14)) >>> 0;
    return (value % 6) + 1;
  };
}

export function createInitialGameState(options: GameCreationOptions): GameState;
/** @deprecated Provide a stable id and seed through GameCreationOptions. */
export function createInitialGameState(
  mode?: GameMode,
  humanColor?: PlayerColor,
  botPersonalities?: Partial<Record<PlayerColor, BotPersonality>>,
  customRules?: Partial<GameRules>
): GameState;
export function createInitialGameState(
  optionsOrMode: GameCreationOptions | GameMode = 'solo_bots',
  legacyHumanColor: PlayerColor = 'red',
  legacyBotPersonalities?: Partial<Record<PlayerColor, BotPersonality>>,
  legacyRules?: Partial<GameRules>
): GameState {
  const fallbackSeed = typeof optionsOrMode === 'string'
    ? `deprecated-${optionsOrMode}-${legacyHumanColor}`
    : '';
  const options: GameCreationOptions = typeof optionsOrMode === 'string'
    ? { id: `game-${fallbackSeed}`, seed: fallbackSeed, mode: optionsOrMode, humanColor: legacyHumanColor, botPersonalities: legacyBotPersonalities, customRules: legacyRules }
    : optionsOrMode;
  const mode = options.mode ?? 'solo_bots';
  const humanColor = options.humanColor ?? 'red';
  const botPersonalities = options.botPersonalities;
  const customRules = options.customRules;
  const isTeam = mode === 'team_2v2';
  const rules: GameRules = { ...DEFAULT_RULES, ...customRules };

  const defaultPersonalities: Record<PlayerColor, BotPersonality> = {
    red: 'balanced',
    green: 'aggressive',
    yellow: 'balanced',
    blue: 'defensive',
    ...botPersonalities,
  };

  const players: Player[] = COLOR_ORDER.map((color) => {
    let isBot = false;
    let name = '';
    let isActiveInMatch = true;

    if (mode === 'head_to_head_1v1') {
      const rivalColor: PlayerColor = humanColor === 'red' ? 'yellow' : humanColor === 'yellow' ? 'red' : humanColor === 'green' ? 'blue' : 'green';
      if (color !== humanColor && color !== rivalColor) {
        isActiveInMatch = false;
        name = `Inactive (${color})`;
      } else if (color === humanColor) {
        name = 'You (Challenger)';
        isBot = false;
      } else {
        name = `Bot ${color.toUpperCase()} (Rival)`;
        isBot = true;
      }
    } else if (mode === 'solo_bots') {
      isBot = color !== humanColor;
      if (color === humanColor) {
        name = 'You (Captain)';
      } else {
        const pType = defaultPersonalities[color];
        const title = pType.charAt(0).toUpperCase() + pType.slice(1);
        name = `Bot ${color.toUpperCase()} (${title})`;
      }
    } else if (mode === 'pass_and_play') {
      isBot = false;
      name = `Player ${color.toUpperCase()}`;
    } else if (mode === 'team_2v2') {
      // Human is red, teammate yellow is bot or human
      isBot = color !== humanColor;
      const teamLabel = COLOR_TEAMS[color] === 'team_A' ? 'Alpha' : 'Omega';
      name = color === humanColor ? `You [Team ${teamLabel}]` : `Bot ${color} [Team ${teamLabel}]`;
    } else {
      // classic_4p
      isBot = color !== humanColor;
      name = color === humanColor ? 'You' : `Player ${color.toUpperCase()}`;
    }

    return {
      id: `player-${color}`,
      name,
      color,
      isBot,
      botPersonality: isBot ? defaultPersonalities[color] : undefined,
      difficulty: isBot ? 'medium' : undefined,
      avatarSeed: `avatar-${color}`,
      tokens: isActiveInMatch ? generateTokens(color) : [],
      tokensFinished: 0,
      captures: 0,
      hasWon: false,
      teamId: isTeam ? COLOR_TEAMS[color] : undefined,
      isActiveInMatch,
    };
  });

  const firstActiveColor = players.find((player) => player.isActiveInMatch !== false)?.color ?? 'red';
  const initialLog: GameLogEntry[] = [
    makeLogEntry(firstActiveColor, 'info', `Match started in ${mode.replace(/_/g, ' ').toUpperCase()} mode.`, 0),
    makeLogEntry(firstActiveColor, 'turn', `${firstActiveColor.toUpperCase()}'s turn to roll the dice.`, 1),
  ];

  return {
    id: options.id,
    mode,
    rules,
    players,
    currentTurnColor: firstActiveColor,
    phase: 'rolling',
    diceValue: null,
    consecutiveSixes: 0,
    legalMoves: [],
    winnerColor: null,
    winners: [],
    isTeamMode: isTeam,
    winningTeam: null,
    log: initialLog,
    lastAction: null,
    seed: options.seed,
    rngState: seedToNumber(options.seed),
    nextEventId: 2,
    events: [],
  };
}

/**
 * Returns the next player color in clockwise turn order
 */
export function getNextTurnColor(
  currentColor: PlayerColor,
  players: Player[],
  isTeamMode: boolean = false
): PlayerColor {
  const currentIdx = COLOR_ORDER.indexOf(currentColor);
  for (let i = 1; i <= 4; i++) {
    const nextColor = COLOR_ORDER[(currentIdx + i) % 4];
    const player = players.find((p) => p.color === nextColor);
    if (!player) continue;

    // Skip inactive players (e.g. Green and Blue in 1v1 mode)
    if (player.isActiveInMatch === false) continue;

    // In 2v2 team mode: if player has won, do NOT skip them unless their partner has ALSO won!
    if (isTeamMode && player.teamId) {
      const partner = players.find((p) => p.teamId === player.teamId && p.color !== player.color);
      const teamAllHome = player.hasWon && (!partner || partner.hasWon);
      if (teamAllHome) {
        continue;
      }
      return nextColor;
    }

    // Individual mode: if player has already won, skip them
    if (!player.hasWon) {
      return nextColor;
    }
  }
  return currentColor;
}

/**
 * Generates a cryptographically fair, unbiased dice roll (1 to 6)
 * Uses rejection sampling on crypto.getRandomValues to eliminate any modulo bias
 */
export function getFairDiceRoll(): number {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('Secure randomness is unavailable.');
  const buf = new Uint32Array(1);
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % 6);
  let sample: number;
  do {
    crypto.getRandomValues(buf);
    sample = buf[0];
  } while (sample >= limit);
  return (sample % 6) + 1;
}

/**
 * Simulates or sets the dice roll using provably fair PRNG
 */
function rollDiceState(state: GameState, diceValue: number): GameState {

  const currentPlayer = state.players.find((p) => p.color === state.currentTurnColor)!;
  const movingColor = state.currentTurnColor;

  const consecutiveSixes = diceValue === 6 ? state.consecutiveSixes + 1 : 0;
  const newLog = [...state.log];
  const rngState = nextRngState(state.rngState, diceValue);

  // Three consecutive sixes: the third roll is forfeited (game-rules.md §5.4)
  if (consecutiveSixes === 3 && state.rules.consecutiveSixForfeit) {
    newLog.push(
      makeLogEntry(
        movingColor,
        'roll',
        `3 Consecutive Sixes! ${currentPlayer.name}'s 3rd roll is forfeited. Passing turn...`,
        nextLogId(newLog)
      )
    );

    return {
      ...state,
      diceValue,
      consecutiveSixes: 0,
      phase: 'moving',
      legalMoves: [],
      log: newLog.slice(-MAX_LOG_ENTRIES),
      lastAction: { type: 'pass', color: movingColor, dice: diceValue },
      rngState,
      ...appendEvents(state, [
        { type: 'DICE_ROLLED', color: movingColor, value: diceValue },
        { type: 'FORFEIT', color: movingColor, value: diceValue },
      ]),
    };
  }

  newLog.push(makeLogEntry(movingColor, 'roll', `${currentPlayer.name} rolled a ${diceValue}.`, nextLogId(newLog)));

  const legalMoves = getLegalMoves(
    currentPlayer,
    diceValue,
    state.players,
    state.rules,
    state.isTeamMode
  );

  if (legalMoves.length === 0) {
    // A 6 earns another roll even when nothing can move (game-rules.md §5.1)
    if (diceValue === 6 && state.rules.extraTurnOnSixNoMove) {
      newLog.push(
        makeLogEntry(movingColor, 'info', `No moves with 6. ${currentPlayer.name} rolls again.`, nextLogId(newLog))
      );
      return {
        ...state,
        diceValue,
        consecutiveSixes,
        phase: 'rolling',
        legalMoves: [],
        log: newLog.slice(-MAX_LOG_ENTRIES),
        lastAction: { type: 'roll', color: movingColor, dice: diceValue },
        rngState,
        ...appendEvents(state, [
          { type: 'DICE_ROLLED', color: movingColor, value: diceValue },
          { type: 'NO_MOVE', color: movingColor, value: diceValue },
        ]),
      };
    }

    // No legal move: the turn passes (the UI shows the dice for a moment first)
    newLog.push(
      makeLogEntry(
        movingColor,
        'info',
        `No moves possible with rolled ${diceValue}. Turn passing...`,
        nextLogId(newLog)
      )
    );

    return {
      ...state,
      diceValue,
      consecutiveSixes: 0,
      phase: 'moving',
      legalMoves: [],
      log: newLog.slice(-MAX_LOG_ENTRIES),
      lastAction: { type: 'pass', color: movingColor, dice: diceValue },
      rngState,
      ...appendEvents(state, [
        { type: 'DICE_ROLLED', color: movingColor, value: diceValue },
        { type: 'NO_MOVE', color: movingColor, value: diceValue },
      ]),
    };
  }

  return {
    ...state,
    diceValue,
    consecutiveSixes,
    phase: 'moving',
    legalMoves,
    log: newLog.slice(-MAX_LOG_ENTRIES),
    lastAction: { type: 'roll', color: movingColor, dice: diceValue },
    rngState,
    ...appendEvents(state, [{ type: 'DICE_ROLLED', color: movingColor, value: diceValue }]),
  };
}

export function rollDice(state: GameState, diceValue: number): EngineResult<GameState> {
  if (state.phase === 'game_over') return { ok: false, error: 'GAME_OVER' };
  if (state.phase !== 'rolling') return { ok: false, error: 'WRONG_PHASE' };
  if (!Number.isInteger(diceValue) || diceValue < 1 || diceValue > 6) {
    return { ok: false, error: 'INVALID_DICE' };
  }
  return { ok: true, state: rollDiceState(state, diceValue) };
}

export function getAutomaticMove(state: GameState): GameState['legalMoves'][number] | null {
  if (state.phase !== 'moving' || state.diceValue === null || state.diceValue === 6) return null;
  return state.legalMoves.length === 1 ? state.legalMoves[0] : null;
}

/**
 * Credits one capture to the moving player
 */
function creditCapture(players: Player[], movingColor: PlayerColor): Player[] {
  return players.map((p) => (p.color === movingColor ? { ...p, captures: p.captures + 1 } : p));
}
// Callers must only credit when a capture actually happened (see applyMove).

/**
 * Applies a move for a given token of the current player
 */
function applyMoveState(state: GameState, tokenIndex: number, tokenColor?: PlayerColor): GameState {
  if (state.phase !== 'moving' || state.diceValue === null) {
    return state;
  }

  const matchingMove = state.legalMoves.find(
    (m) => m.tokenIndex === tokenIndex && (!tokenColor || (m.tokenColor ?? state.currentTurnColor) === tokenColor)
  );
  if (!matchingMove) {
    return state; // Invalid move
  }

  // Keep the authoritative move aligned with the displayed roll. A yard exit
  // lands on step 0; every token already on the path advances exactly diceValue.
  const expectedToStep = getMoveDestination(
    matchingMove.fromStep,
    state.diceValue,
    matchingMove.isExitYard
  );
  if (matchingMove.toStep !== expectedToStep) {
    return state;
  }

  const newLog = [...state.log];
  const movingColor = state.currentTurnColor;
  const targetColor = matchingMove.tokenColor || movingColor;
  // The captured token is known from move generation; it is unchanged since the roll
  const capturedTokenInfos = matchingMove.willCaptureTokens;

  // Clone players & tokens
  const newPlayers = state.players.map((player) => {
    if (player.color === targetColor) {
      const updatedTokens = player.tokens.map((token) => {
        if (token.index === tokenIndex) {
          return {
            ...token,
            stepCount: matchingMove.toStep,
            isHome: matchingMove.isFinish,
            isInYard: false,
          };
        }
        return token;
      });

      const tokensFinished = updatedTokens.filter((t) => t.isHome).length;

      return {
        ...player,
        tokens: updatedTokens,
        tokensFinished,
        hasWon: tokensFinished === 4,
      };
    }

    // Send the captured opponent token back to its yard
    if (capturedTokenInfos.some((capturedToken) => player.color === capturedToken.color)) {
      const updatedTokens = player.tokens.map((token) => {
        if (capturedTokenInfos.some((capturedToken) => capturedToken.color === player.color && capturedToken.index === token.index)) {
          return {
            ...token,
            stepCount: -1,
            isInYard: true,
            isHome: false,
          };
        }
        return token;
      });

      return {
        ...player,
        tokens: updatedTokens,
      };
    }

    return player;
  });

  const currentPlayer = newPlayers.find((p) => p.color === movingColor)!;
  const targetPlayer = newPlayers.find((p) => p.color === targetColor)!;

  // Logging move events
  if (matchingMove.isPartnerAssist) {
    newLog.push(
      makeLogEntry(
        movingColor,
        'move',
        `Partner Assist! ${currentPlayer.name} moved partner ${targetPlayer.name}'s token ${tokenIndex + 1} to step ${matchingMove.toStep}.`,
        nextLogId(newLog)
      )
    );
  } else if (matchingMove.isExitYard) {
    newLog.push(
      makeLogEntry(movingColor, 'enter', `${currentPlayer.name} deployed a token to the track.`, nextLogId(newLog))
    );
  } else if (matchingMove.isFinish) {
    newLog.push(
      makeLogEntry(
        movingColor,
        'finish',
        `Triumph! ${currentPlayer.name} brought a token HOME! (${targetPlayer.tokensFinished}/4)`,
        nextLogId(newLog)
      )
    );
  } else {
    newLog.push(
      makeLogEntry(
        movingColor,
        'move',
        `${currentPlayer.name} moved token ${tokenIndex + 1} to step ${matchingMove.toStep}.`,
        nextLogId(newLog)
      )
    );
  }

  for (const capturedToken of capturedTokenInfos) {
    newLog.push(makeLogEntry(movingColor, 'capture', `Strike! ${currentPlayer.name} captured ${capturedToken.color.toUpperCase()}'s token!`, nextLogId(newLog)));
  }

  // Check victory conditions
  const newWinners = [...state.winners];
  if (targetPlayer.hasWon && !newWinners.includes(targetColor)) {
    newWinners.push(targetColor);
  }

  let isGameOver = false;
  let winningTeam: TeamId | null = null;
  let winnerColor: PlayerColor | null = state.winnerColor;

  if (state.isTeamMode) {
    const teamA = newPlayers.filter((p) => p.teamId === 'team_A');
    const teamB = newPlayers.filter((p) => p.teamId === 'team_B');
    const teamAFinished = teamA.reduce((sum, p) => sum + p.tokensFinished, 0);
    const teamBFinished = teamB.reduce((sum, p) => sum + p.tokensFinished, 0);

    if (teamAFinished === 8 || teamA.every((p) => p.hasWon)) {
      isGameOver = true;
      winningTeam = 'team_A';
      winnerColor = targetColor;
    } else if (teamBFinished === 8 || teamB.every((p) => p.hasWon)) {
      isGameOver = true;
      winningTeam = 'team_B';
      winnerColor = targetColor;
    }
  } else {
    // 1v1, solo, classic: the first active player to bring in 4 tokens wins
    const activeUnfinishedPlayers = newPlayers.filter((player) => player.isActiveInMatch !== false && !player.hasWon);
    if (newWinners.length > 0 && !state.rules.continueUntilRanked) {
      isGameOver = true;
      winnerColor = newWinners[0];
    } else if (state.rules.continueUntilRanked && activeUnfinishedPlayers.length <= 1) {
      if (activeUnfinishedPlayers.length === 1 && !newWinners.includes(activeUnfinishedPlayers[0].color)) {
        newWinners.push(activeUnfinishedPlayers[0].color);
      }
      isGameOver = true;
      winnerColor = newWinners[0] ?? null;
    }
  }

  const lastAction = {
    type: 'move' as const,
    color: movingColor,
    tokenIndex,
    dice: state.diceValue,
    capturedToken: capturedTokenInfos[0] ?? null,
  };

  if (isGameOver) {
    newLog.push(
      makeLogEntry(
        winnerColor || movingColor,
        'finish',
        state.isTeamMode
          ? `VICTORY! Team ${winningTeam === 'team_A' ? 'Alpha' : 'Omega'} wins the match!`
          : `VICTORY! ${targetPlayer.name} has won the match!`,
        nextLogId(newLog)
      )
    );

    const events: GameEventInput[] = [
      { type: 'TOKEN_MOVED', color: targetColor, tokenIndex, fromStep: matchingMove.fromStep, toStep: matchingMove.toStep },
      ...capturedTokenInfos.map((token) => ({ type: 'TOKEN_CAPTURED' as const, color: movingColor, tokenColor: token.color, tokenIndex: token.index })),
      ...(matchingMove.isFinish ? [{ type: 'TOKEN_FINISHED' as const, color: targetColor, tokenIndex }] : []),
      { type: 'GAME_OVER', color: winnerColor ?? targetColor, ...(winningTeam ? { teamId: winningTeam } : {}) },
    ];
    return {
      ...state,
      players: capturedTokenInfos.length ? capturedTokenInfos.reduce((players) => creditCapture(players, movingColor), newPlayers) : newPlayers,
      phase: 'game_over',
      winnerColor,
      winners: newWinners,
      winningTeam,
      legalMoves: [],
      diceValue: null,
      log: newLog.slice(-MAX_LOG_ENTRIES),
      lastAction,
      ...appendEvents(state, events),
    };
  }

  // Check extra turn rules
  const earnedBonusTurn =
    (state.diceValue === 6 && state.rules.extraTurnOnSix) ||
    (capturedTokenInfos.length > 0 && state.rules.extraTurnOnCapture) ||
    (matchingMove.isFinish && state.rules.extraTurnOnFinish);

  let nextTurnColor = movingColor;
  if (!earnedBonusTurn) {
    nextTurnColor = getNextTurnColor(movingColor, newPlayers, state.isTeamMode);
    newLog.push(
      makeLogEntry(nextTurnColor, 'turn', `${nextTurnColor.toUpperCase()}'s turn to roll.`, nextLogId(newLog))
    );
  } else {
    const reason =
      state.diceValue === 6
        ? 'rolling a 6'
        : capturedTokenInfos.length > 0
          ? 'capturing a token'
          : 'bringing a token home';
    newLog.push(
      makeLogEntry(
        movingColor,
        'info',
        `Bonus Turn! ${currentPlayer.name} earned an extra turn for ${reason}.`,
        nextLogId(newLog)
      )
    );
  }

  const events: GameEventInput[] = [
    { type: 'TOKEN_MOVED', color: targetColor, tokenIndex, fromStep: matchingMove.fromStep, toStep: matchingMove.toStep },
    ...capturedTokenInfos.map((token) => ({ type: 'TOKEN_CAPTURED' as const, color: movingColor, tokenColor: token.color, tokenIndex: token.index })),
    ...(matchingMove.isFinish ? [{ type: 'TOKEN_FINISHED' as const, color: targetColor, tokenIndex }] : []),
    ...(nextTurnColor !== movingColor ? [{ type: 'TURN_CHANGED' as const, color: nextTurnColor }] : []),
  ];
  return {
    ...state,
    players: capturedTokenInfos.length ? capturedTokenInfos.reduce((players) => creditCapture(players, movingColor), newPlayers) : newPlayers,
    currentTurnColor: nextTurnColor,
    phase: 'rolling',
    diceValue: null,
    legalMoves: [],
    consecutiveSixes: state.diceValue === 6 && nextTurnColor === movingColor ? state.consecutiveSixes : 0,
    log: newLog.slice(-MAX_LOG_ENTRIES),
    lastAction,
    ...appendEvents(state, events),
  };
}

export function applyMove(
  state: GameState,
  action: { actorColor: PlayerColor; tokenColor?: PlayerColor; tokenIndex: number }
): EngineResult<GameState> {
  if (state.phase === 'game_over') return { ok: false, error: 'GAME_OVER' };
  if (state.phase !== 'moving') return { ok: false, error: 'WRONG_PHASE' };
  if (action.actorColor !== state.currentTurnColor) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!Number.isInteger(action.tokenIndex) || action.tokenIndex < 0) return { ok: false, error: 'ILLEGAL_MOVE' };
  const next = applyMoveState(state, action.tokenIndex, action.tokenColor);
  return next === state ? { ok: false, error: 'ILLEGAL_MOVE' } : { ok: true, state: next };
}

function passTurnState(state: GameState): GameState {
  const nextTurn = getNextTurnColor(state.currentTurnColor, state.players, state.isTeamMode);
  const newLog = [...state.log];
  newLog.push(makeLogEntry(nextTurn, 'turn', `${nextTurn.toUpperCase()}'s turn to roll.`, nextLogId(newLog)));

  return {
    ...state,
    diceValue: null,
    consecutiveSixes: 0,
    phase: 'rolling',
    currentTurnColor: nextTurn,
    legalMoves: [],
    log: newLog.slice(-MAX_LOG_ENTRIES),
    lastAction: {
      type: 'pass',
      color: state.currentTurnColor,
      dice: state.diceValue ?? undefined,
    },
    ...appendEvents(state, [{ type: 'TURN_CHANGED', color: nextTurn }]),
  };
}

export function passTurn(state: GameState): EngineResult<GameState> {
  if (state.phase === 'game_over') return { ok: false, error: 'GAME_OVER' };
  if (state.phase !== 'moving') return { ok: false, error: 'WRONG_PHASE' };
  if (state.legalMoves.length > 0) return { ok: false, error: 'ILLEGAL_MOVE' };
  return { ok: true, state: passTurnState(state) };
}

export function advanceIfStuck(state: GameState): EngineResult<GameState> {
  return passTurn(state);
}

/** Server-only timeout transition; passTurn remains restricted to a stuck roll. */
export function forfeitTimedOutTurn(state: GameState): EngineResult<GameState> {
  if (state.phase === 'game_over') return { ok: false, error: 'GAME_OVER' };
  if (state.phase !== 'rolling' && state.phase !== 'moving') return { ok: false, error: 'WRONG_PHASE' };
  return { ok: true, state: passTurnState(state) };
}

export function formatEvent(event: GameEvent, locale: 'en' | 'bn' = 'en'): string {
  const colorNames = locale === 'bn'
    ? { red: 'লাল', green: 'সবুজ', yellow: 'হলুদ', blue: 'নীল' }
    : { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };
  switch (event.type) {
    case 'DICE_ROLLED': return locale === 'bn' ? `${colorNames[event.color]} ${event.value} তুলেছে।` : `${colorNames[event.color]} rolled ${event.value}.`;
    case 'TOKEN_MOVED': return locale === 'bn' ? `${colorNames[event.color]}-এর গুটি ${event.toStep - event.fromStep} ঘর এগিয়েছে।` : `${colorNames[event.color]} moved a token ${event.toStep - event.fromStep} spaces.`;
    case 'TOKEN_CAPTURED': return locale === 'bn' ? `${colorNames[event.tokenColor]}-এর গুটি ধরা হয়েছে।` : `${colorNames[event.tokenColor]} token was captured.`;
    case 'TOKEN_FINISHED': return locale === 'bn' ? `${colorNames[event.color]}-এর গুটি ঘরে পৌঁছেছে।` : `${colorNames[event.color]} finished a token.`;
    case 'TURN_CHANGED': return locale === 'bn' ? `${colorNames[event.color]}-এর পালা।` : `${colorNames[event.color]}'s turn.`;
    case 'FORFEIT': return locale === 'bn' ? `${colorNames[event.color]}-এর ${event.value} বাতিল হয়েছে।` : `${colorNames[event.color]} forfeited a ${event.value}.`;
    case 'NO_MOVE': return locale === 'bn' ? `${colorNames[event.color]}-এর কোনো চাল নেই (${event.value})।` : `${colorNames[event.color]} has no move for ${event.value}.`;
    case 'GAME_OVER': return locale === 'bn' ? 'খেলা শেষ।' : 'Game over.';
  }
}

export function getGameInvariantViolations(state: GameState): string[] {
  const violations: string[] = [];
  for (const player of state.players) {
    const expectedTokens = player.isActiveInMatch === false ? 0 : 4;
    if (player.tokens.length !== expectedTokens) violations.push(`${player.color}: expected ${expectedTokens} tokens`);
    for (const token of player.tokens) {
      if (token.stepCount < -1 || token.stepCount > TOTAL_STEPS_TO_FINISH) violations.push(`${token.id}: invalid stepCount`);
      if (token.isInYard !== (token.stepCount === -1)) violations.push(`${token.id}: yard flag mismatch`);
      if (token.isHome !== (token.stepCount === TOTAL_STEPS_TO_FINISH)) violations.push(`${token.id}: home flag mismatch`);
    }
    const finished = player.tokens.filter((token) => token.stepCount === TOTAL_STEPS_TO_FINISH).length;
    if (player.tokensFinished !== finished) violations.push(`${player.color}: tokensFinished mismatch`);
  }
  const occupants = new Map<number, PlayerColor[]>();
  for (const player of state.players) for (const token of player.tokens) {
    if (token.stepCount < 0 || token.stepCount > LAST_TRACK_STEP) continue;
    const cell = (COLOR_START_TRACK_INDEX[player.color] + token.stepCount) % TOTAL_TRACK_CELLS;
    occupants.set(cell, [...(occupants.get(cell) ?? []), player.color]);
  }
  for (const [cell, colors] of occupants) {
    const unique = [...new Set(colors)];
    const safe = state.rules.startSquaresAlwaysSafe && START_TRACK_CELLS.has(cell) || state.rules.safeStarsActive && STAR_TRACK_CELLS.has(cell);
    const teamOf = (color: PlayerColor) => state.players.find((player) => player.color === color)?.teamId ?? COLOR_TEAMS[color];
    if (!safe && unique.length > 1 && (!state.isTeamMode || unique.some((color) => teamOf(color) !== teamOf(unique[0])))) {
      violations.push(`cell ${cell}: opposing colors share an unsafe cell`);
    }
    if (state.rules.blocksEnabled && unique.length > 1 && (!state.isTeamMode || unique.some((color) => teamOf(color) !== teamOf(unique[0])))) {
      violations.push(`cell ${cell}: opponents share a block`);
    }
  }
  return violations;
}

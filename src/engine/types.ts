/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export type PlayerType = 'human' | 'bot';

export type BotPersonality = 'balanced' | 'aggressive' | 'defensive';
export type BotDifficulty = 'easy' | 'medium' | 'hard';

export type GameMode =
  | 'classic_4p'
  | 'team_2v2'
  | 'solo_bots'
  | 'pass_and_play'
  | 'head_to_head_1v1';

export type TeamId = 'team_A' | 'team_B';

export interface TokenState {
  id: string; // e.g., 'red-0'
  color: PlayerColor;
  index: number; // 0, 1, 2, 3
  stepCount: number; // -1: Yard, 0: Start square, 1..50: Main track, 51..55: Home path, 56: Finished in Center
  isHome: boolean; // Reached center
  isInYard: boolean;
}

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  isBot: boolean;
  botPersonality?: BotPersonality;
  difficulty?: BotDifficulty;
  avatarSeed: string;
  tokens: TokenState[];
  tokensFinished: number;
  captures: number; // Opponent tokens this player has sent back to the yard
  hasWon: boolean;
  rank?: number;
  teamId?: TeamId;
  isActiveInMatch?: boolean; // false for inactive players in 1v1 head-to-head mode
}

export type GamePhase = 'waiting' | 'rolling' | 'moving' | 'game_over';

export interface GameRules {
  sixToExit: boolean; // true = 6 needed; false = 1 or 6
  extraTurnOnSix: boolean; // default true
  extraTurnOnCapture: boolean; // default true
  extraTurnOnFinish: boolean; // default true
  consecutiveSixForfeit: boolean; // 3 consecutive sixes forfeits turn
  safeStarsActive: boolean; // 8 safe star cells where captures cannot occur
  startSquaresAlwaysSafe: boolean;
  blocksEnabled: boolean;
  blockStopsPassing: boolean;
  extraTurnOnSixNoMove: boolean;
  continueUntilRanked: boolean;
}

export interface MoveAction {
  tokenColor?: PlayerColor; // Color of token being moved (supports assisting partner in 2v2)
  tokenIndex: number;
  fromStep: number;
  toStep: number;
  isExitYard: boolean;
  isFinish: boolean;
  willCaptureTokens: TokenState[];
  isPartnerAssist?: boolean;
}

export type EngineErrorCode = 'WRONG_PHASE' | 'NOT_YOUR_TURN' | 'INVALID_DICE' | 'ILLEGAL_MOVE' | 'GAME_OVER';
export type EngineResult<T> = { ok: true; state: T } | { ok: false; error: EngineErrorCode };

export type GameEvent =
  | { id: number; type: 'DICE_ROLLED'; color: PlayerColor; value: number }
  | { id: number; type: 'TOKEN_MOVED'; color: PlayerColor; tokenIndex: number; fromStep: number; toStep: number }
  | { id: number; type: 'TOKEN_CAPTURED'; color: PlayerColor; tokenColor: PlayerColor; tokenIndex: number }
  | { id: number; type: 'TOKEN_FINISHED'; color: PlayerColor; tokenIndex: number }
  | { id: number; type: 'TURN_CHANGED'; color: PlayerColor }
  | { id: number; type: 'FORFEIT'; color: PlayerColor; value: number }
  | { id: number; type: 'NO_MOVE'; color: PlayerColor; value: number }
  | { id: number; type: 'GAME_OVER'; color: PlayerColor; teamId?: TeamId };
export type GameEventInput = {
  [Kind in GameEvent['type']]: Omit<Extract<GameEvent, { type: Kind }>, 'id'>
}[GameEvent['type']];

export interface GameLogEntry {
  id: string;
  timestamp: number;
  color: PlayerColor;
  message: string;
  type: 'roll' | 'move' | 'capture' | 'enter' | 'finish' | 'turn' | 'info';
}

export interface GameState {
  id: string;
  mode: GameMode;
  rules: GameRules;
  players: Player[];
  currentTurnColor: PlayerColor;
  phase: GamePhase;
  diceValue: number | null;
  consecutiveSixes: number;
  legalMoves: MoveAction[];
  winnerColor: PlayerColor | null;
  winners: PlayerColor[];
  isTeamMode: boolean;
  winningTeam: TeamId | null;
  log: GameLogEntry[];
  seed: string;
  rngState: number;
  nextEventId: number;
  events: GameEvent[];
  lastAction: {
    type: 'roll' | 'move' | 'pass';
    color: PlayerColor;
    tokenIndex?: number;
    dice?: number;
    capturedToken?: TokenState | null;
  } | null;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GameMode, GameRules, GameState, PlayerColor, TeamId } from '../engine/types';

export const LUDO_PROTOCOL_VERSION = '1.0.0';

/** Actions sent over an authenticated room WebSocket. Room creation/joining use HTTP. */
export type ClientMessage =
  | { type: 'CLIENT_AUTH'; payload: { token: string } }
  | { type: 'CLIENT_SET_READY'; payload: { isReady: boolean } }
  | { type: 'CLIENT_START_MATCH' }
  | { type: 'CLIENT_REQUEST_REMATCH' }
  | { type: 'CLIENT_BACK_TO_LOBBY' }
  | { type: 'CLIENT_ROLL_DICE' }
  | { type: 'CLIENT_SELECT_MOVE'; payload: { tokenIndex: number; tokenColor?: PlayerColor } }
  | { type: 'CLIENT_LEAVE_ROOM' }
  | { type: 'CLIENT_PING'; payload: { clientTimestamp: number } };

export interface RoomParticipant {
  id: string;
  name: string;
  color: PlayerColor;
  isHost: boolean;
  isReady: boolean;
  isBot: boolean;
  teamId?: TeamId;
  pingMs: number;
  isConnected?: boolean;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  mode: GameMode;
  rules: GameRules;
  participants: RoomParticipant[];
  maxPlayers: number;
  isMatchInProgress: boolean;
  rematchRequests?: string[];
}

export type ServerMessage =
  | { type: 'SERVER_AUTHENTICATED'; payload: { roomCode: string } }
  | { type: 'SERVER_ROOM_STATE'; payload: RoomSnapshot }
  | {
      type: 'SERVER_MATCHMAKING_STATUS';
      payload: { status: 'searching' | 'matched' | 'cancelled'; estimatedWaitSeconds: number; playersInQueue: number; assignedRoomCode?: string };
    }
  | {
      type: 'SERVER_GAME_STATE_SYNC';
      payload: { state: GameState; serverTimestamp: number; turnTimeRemainingSeconds: number };
    }
  | { type: 'SERVER_TURN_TIMEOUT'; payload: { timedOutColor: PlayerColor; autoPickedTokenIndex?: number } }
  | { type: 'SERVER_PLAYER_DISCONNECTED'; payload: { playerId: string; color: PlayerColor; reconnectGracePeriodSeconds: number } }
  | {
      type: 'SERVER_ERROR';
      payload: {
        code: string;
        message: string;
      };
    }
  | { type: 'SERVER_PONG'; payload: { clientTimestamp: number; serverTimestamp: number } };

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
  | { type: 'CLIENT_REQUEST_TEAM_SWAP'; payload: { targetParticipantId: string } }
  | { type: 'CLIENT_RESPOND_TEAM_SWAP'; payload: { requestId: string; accept: boolean } }
  | { type: 'CLIENT_LEAVE_ROOM' }
  | { type: 'CLIENT_PING'; payload: { clientTimestamp: number } }
  | { type: 'CLIENT_SET_CHAT_ENABLED'; payload: { enabled: boolean } }
  | { type: 'CLIENT_SET_VOICE_ENABLED'; payload: { enabled: boolean } }
  | { type: 'CLIENT_VOICE_PERMISSION'; payload: { granted: boolean } }
  | { type: 'chat'; text: string }
  | { type: 'chat_reaction'; reaction: ChatReaction }
  | { type: 'voice_join' }
  | { type: 'voice_leave' };

export type ChatReaction = 'thumbs_up' | 'laugh' | 'wow' | 'angry' | 'party' | 'gg';

export interface ChatMessage {
  id: string;
  color: PlayerColor;
  name: string;
  text: string;
  sentAt: number;
  reaction?: ChatReaction;
}

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
  teamSwapRequest?: { id: string; requesterId: string; targetId: string; expiresAt: number } | null;
  chatEnabled?: boolean;
  voiceEnabled?: boolean;
  voiceAvailable?: boolean;
  seatsInVoice?: PlayerColor[];
}

export interface OnlineCapturedToken { color: PlayerColor; tokenIndex: number; fromStep: number }
export interface OnlineTokenMove {
  id: string;
  color: PlayerColor;
  tokenIndex: number;
  fromStep: number;
  toStep: number;
  capturedTokens?: OnlineCapturedToken[];
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
      payload: { state: GameState; serverTimestamp: number; turnTimeRemainingSeconds: number; move?: OnlineTokenMove };
    }
  | { type: 'SERVER_TURN_TIMEOUT'; payload: { timedOutColor: PlayerColor; autoPickedTokenIndex?: number } }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat_history'; messages: ChatMessage[] }
  | { type: 'voice_token'; authToken: string }
  | { type: 'voice_status'; seatsInVoice: PlayerColor[] }
  | { type: 'voice_budget_warning'; payload: { month: string; totalMinutes: number; limitMinutes: number } }
  | { type: 'voice_session_expired' }
  | {
      type: 'error';
      code:
        | 'CHAT_RATE_LIMITED' | 'CHAT_INVALID' | 'CHAT_DISABLED'
        | 'VOICE_DISABLED' | 'VOICE_BUDGET_REACHED' | 'VOICE_ROOM_FULL' | 'VOICE_UNAVAILABLE'
        | 'VOICE_NOT_ALLOWED' | 'VOICE_RATE_LIMITED';
      retryAfterSeconds?: number;
    }
  | { type: 'SERVER_PLAYER_DISCONNECTED'; payload: { playerId: string; color: PlayerColor; reconnectGracePeriodSeconds: number } }
  | {
      type: 'SERVER_ERROR';
      payload: {
        code: string;
        message: string;
      };
    }
  | { type: 'SERVER_PONG'; payload: { clientTimestamp: number; serverTimestamp: number } };

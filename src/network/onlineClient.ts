import type { GameRules, GameState, PlayerColor } from '../engine/types';
import type { ChatMessage, ChatReaction, OnlineTokenMove, RoomSnapshot, ServerMessage } from './protocol';

const API_URL = (
  import.meta.env.VITE_MULTIPLAYER_API_URL ||
  (import.meta.env.PROD && typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/$/, '');

export interface CreateRoomOptions {
  mode: 'classic_4p' | 'team_2v2';
  playerName: string;
  rules: GameRules;
}

interface RoomCredentials {
  roomCode: string;
  participantId: string;
  token: string;
  room: RoomSnapshot;
}

export type RoomEvent =
  | { type: 'room'; room: RoomSnapshot }
  | { type: 'game'; state: GameState; turnTimeRemainingSeconds: number; move?: OnlineTokenMove }
  | { type: 'timeout'; color: PlayerColor }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat_history'; messages: ChatMessage[] }
  | { type: 'chat_error'; code: 'CHAT_RATE_LIMITED' | 'CHAT_INVALID' | 'CHAT_DISABLED'; retryAfterSeconds?: number }
  | { type: 'voice_token'; authToken: string }
  | { type: 'voice_status'; seatsInVoice: PlayerColor[] }
  | { type: 'voice_error'; code: 'VOICE_DISABLED' | 'VOICE_BUDGET_REACHED' | 'VOICE_ROOM_FULL' | 'VOICE_UNAVAILABLE' | 'VOICE_NOT_ALLOWED' | 'VOICE_RATE_LIMITED'; retryAfterSeconds?: number }
  | { type: 'voice_budget_warning'; month: string; totalMinutes: number; limitMinutes: number }
  | { type: 'voice_session_expired' }
  | { type: 'error'; message: string }
  | { type: 'connection'; connected: boolean };

export class OnlineRoomConnection {
  readonly roomCode: string;
  readonly participantId: string;
  readonly token: string;
  readonly localColor: PlayerColor;
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: RoomEvent) => void>();
  private pingTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private roomSnapshot: RoomSnapshot;
  private gameSnapshot: GameState | null = null;
  private turnTimeRemainingSeconds = 30;
  private seenMoveIds = new Set<string>();
  private chatHistory: ChatMessage[] = [];
  private chatHistoryLoaded = false;
  private voiceRequested = false;

  get currentRoom(): RoomSnapshot {
    return this.roomSnapshot;
  }

  get currentGameState(): GameState | null {
    return this.gameSnapshot;
  }

  private constructor(credentials: RoomCredentials) {
    this.roomCode = credentials.roomCode;
    this.participantId = credentials.participantId;
    this.token = credentials.token;
    this.roomSnapshot = credentials.room;
    this.localColor = credentials.room.participants.find((player) => player.id === credentials.participantId)!.color;
  }

  static get configured(): boolean {
    return Boolean(API_URL);
  }

  static async create(options: CreateRoomOptions): Promise<OnlineRoomConnection> {
    const credentials = await this.request('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(options),
    });
    try { window.localStorage.setItem(this.tokenKey(credentials.roomCode), credentials.token); } catch { /* The live connection still works for this tab. */ }
    const connection = new OnlineRoomConnection(credentials);
    await connection.connect();
    return connection;
  }

  static async join(roomCodeInput: string, playerName: string): Promise<OnlineRoomConnection> {
    const roomCode = roomCodeInput.trim().toUpperCase().replace(/\s+/g, '');
    if (!roomCode) throw new Error('Enter a room code or open your friend’s invite link.');
    return this.joinWithToken(roomCode, playerName, this.getSavedToken(roomCode) ?? undefined);
  }

  static async reconnect(roomCodeInput: string, playerName: string): Promise<OnlineRoomConnection | null> {
    const roomCode = roomCodeInput.trim().toUpperCase().replace(/\s+/g, '');
    if (!roomCode) return null;
    const savedToken = this.getSavedToken(roomCode);
    if (!savedToken) return null;
    return this.joinWithToken(roomCode, playerName, savedToken);
  }

  private static getSavedToken(roomCode: string): string | null {
    try { return window.localStorage.getItem(this.tokenKey(roomCode)); } catch { return null; }
  }

  private static async joinWithToken(roomCode: string, playerName: string, token?: string): Promise<OnlineRoomConnection> {
    const credentials = await this.request(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerName, token }),
    });
    try { window.localStorage.setItem(this.tokenKey(credentials.roomCode), credentials.token); } catch { /* The live connection still works for this tab. */ }
    const connection = new OnlineRoomConnection(credentials);
    await connection.connect();
    return connection;
  }

  static inviteUrl(roomCode: string): string {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('room', roomCode);
    return url.toString();
  }

  private static tokenKey(roomCode: string): string {
    return `ludo-room-token:${roomCode}`;
  }

  private static async request(path: string, init: RequestInit): Promise<RoomCredentials> {
    if (!API_URL) {
      throw new Error('Online rooms are not configured yet. Set VITE_MULTIPLAYER_API_URL to your multiplayer Worker URL.');
    }
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      });
    } catch {
      throw new Error('Could not reach the multiplayer server. Check your connection and try again.');
    }
    const result = await response.json() as RoomCredentials | { error?: string };
    if (!response.ok) throw new Error('error' in result ? result.error ?? 'The room request failed.' : 'The room request failed.');
    return result as RoomCredentials;
  }

  private async connect(): Promise<void> {
    const wsUrl = new URL(`${API_URL}/api/rooms/${encodeURIComponent(this.roomCode)}/ws`);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      let settled = false;
      let timeout: number;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (error) reject(error);
        else {
          this.reconnectAttempt = 0;
          this.emit({ type: 'connection', connected: true });
          this.startHeartbeat();
          resolve();
        }
      };
      timeout = window.setTimeout(() => {
        if (!settled) {
          settle(new Error('The room connection timed out. Try joining again.'));
          socket.close();
        }
      }, 10000);

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'CLIENT_AUTH', payload: { token: this.token } }));
      });
      socket.addEventListener('message', (event) => {
        let message: ServerMessage | undefined;
        try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { /* receive reports malformed data */ }
        this.receive(event.data);
        if (message?.type === 'SERVER_AUTHENTICATED') settle();
        else if (message?.type === 'SERVER_ERROR' && !settled) {
          this.manuallyClosed = true;
          settle(new Error(message.payload.message));
          socket.close();
        }
      });
      socket.addEventListener('error', () => {
        if (!settled) settle(new Error('The room connection failed. Please try again.'));
      });
      socket.addEventListener('close', (event) => {
        this.stopHeartbeat();
        this.emit({ type: 'connection', connected: false });
        if (!settled) settle(new Error(event.code === 4003 ? 'Reconnect token is invalid. Join the room again.' : 'The room connection closed before joining.'));
        if (event.code === 4004 || event.code === 4001 || event.code === 4003) {
          this.manuallyClosed = true;
          this.emit({
            type: 'error',
            message: event.code === 4004
              ? 'The room host ended this room.'
              : event.code === 4001
                ? 'This player reconnected in another tab. Continue in the newer tab.'
                : 'Reconnect token is invalid. Join the room again.',
          });
        } else if (!this.manuallyClosed) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private receive(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      this.emit({ type: 'error', message: 'The server sent an unreadable response.' });
      return;
    }
    if (message.type === 'SERVER_ROOM_STATE') {
      this.roomSnapshot = message.payload;
      if (!message.payload.isMatchInProgress) {
        this.gameSnapshot = null;
        this.turnTimeRemainingSeconds = 30;
      }
      this.emit({ type: 'room', room: message.payload });
    } else if (message.type === 'SERVER_AUTHENTICATED') {
      if (this.voiceRequested) this.sendRaw({ type: 'voice_join' });
    } else if (message.type === 'SERVER_GAME_STATE_SYNC') {
      const previousGameId = this.gameSnapshot?.id;
      this.gameSnapshot = message.payload.state;
      if (this.gameSnapshot.id && this.gameSnapshot.id !== previousGameId) {
        this.seenMoveIds.clear();
      }
      this.turnTimeRemainingSeconds = message.payload.turnTimeRemainingSeconds;
      const move = message.payload.move;
      if (move && this.seenMoveIds.has(move.id)) return;
      if (move) {
        this.seenMoveIds.add(move.id);
        if (this.seenMoveIds.size > 64) this.seenMoveIds.delete(this.seenMoveIds.values().next().value!);
      }
      const freshMove = move;
      this.emit({ type: 'game', state: message.payload.state, turnTimeRemainingSeconds: message.payload.turnTimeRemainingSeconds, ...(freshMove ? { move: freshMove } : {}) });
    } else if (message.type === 'SERVER_TURN_TIMEOUT') {
      this.emit({ type: 'timeout', color: message.payload.timedOutColor });
    } else if (message.type === 'chat_history') {
      this.chatHistory = message.messages.slice(-50);
      this.chatHistoryLoaded = true;
      this.emit({ type: 'chat_history', messages: this.chatHistory });
    } else if (message.type === 'chat') {
      this.chatHistory = [...this.chatHistory, message.message].slice(-50);
      this.emit({ type: 'chat', message: message.message });
    } else if (message.type === 'voice_token') {
      this.emit({ type: 'voice_token', authToken: message.authToken });
    } else if (message.type === 'voice_status') {
      this.emit({ type: 'voice_status', seatsInVoice: message.seatsInVoice });
    } else if (message.type === 'voice_budget_warning') {
      this.emit({ type: 'voice_budget_warning', ...message.payload });
    } else if (message.type === 'voice_session_expired') {
      this.voiceRequested = false;
      this.emit({ type: 'voice_session_expired' });
    } else if (message.type === 'error') {
      if (message.code === 'CHAT_RATE_LIMITED' || message.code === 'CHAT_INVALID' || message.code === 'CHAT_DISABLED') {
        this.emit({
          type: 'chat_error',
          code: message.code,
          ...(message.retryAfterSeconds ? { retryAfterSeconds: message.retryAfterSeconds } : {}),
        });
      } else {
        this.emit({
          type: 'voice_error',
          code: message.code,
          ...(message.retryAfterSeconds ? { retryAfterSeconds: message.retryAfterSeconds } : {}),
        });
      }
    } else if (message.type === 'SERVER_ERROR') {
      this.emit({ type: 'error', message: message.payload.message });
    }
  }

  subscribe(listener: (event: RoomEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'room', room: this.roomSnapshot });
    if (this.gameSnapshot) listener({ type: 'game', state: this.gameSnapshot, turnTimeRemainingSeconds: this.turnTimeRemainingSeconds });
    if (this.chatHistoryLoaded) listener({ type: 'chat_history', messages: this.chatHistory });
    return () => this.listeners.delete(listener);
  }

  private emit(event: RoomEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private send(type: string, payload?: unknown): void {
    this.sendRaw({ type, ...(payload === undefined ? {} : { payload }) });
  }

  private sendRaw(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.emit({ type: 'error', message: 'Reconnecting to the room. Please try that action again in a moment.' });
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  setReady(isReady: boolean): void {
    this.send('CLIENT_SET_READY', { isReady });
  }

  startMatch(): void {
    this.send('CLIENT_START_MATCH');
  }

  requestRematch(): void {
    this.send('CLIENT_REQUEST_REMATCH');
  }

  backToLobby(): void {
    this.send('CLIENT_BACK_TO_LOBBY');
  }

  rollDice(): void {
    this.send('CLIENT_ROLL_DICE');
  }

  selectMove(tokenIndex: number, tokenColor?: PlayerColor): void {
    this.send('CLIENT_SELECT_MOVE', { tokenIndex, tokenColor });
  }

  requestTeamSwap(targetParticipantId: string): void {
    this.send('CLIENT_REQUEST_TEAM_SWAP', { targetParticipantId });
  }

  respondToTeamSwap(requestId: string, accept: boolean): void {
    this.send('CLIENT_RESPOND_TEAM_SWAP', { requestId, accept });
  }

  sendChat(text: string): void {
    this.sendRaw({ type: 'chat', text });
  }

  sendChatReaction(reaction: ChatReaction): void {
    this.sendRaw({ type: 'chat_reaction', reaction });
  }

  setChatEnabled(enabled: boolean): void {
    this.send('CLIENT_SET_CHAT_ENABLED', { enabled });
  }

  setVoiceEnabled(enabled: boolean): void {
    this.send('CLIENT_SET_VOICE_ENABLED', { enabled });
  }

  joinVoice(microphoneGranted: boolean): void {
    this.voiceRequested = true;
    this.send('CLIENT_VOICE_PERMISSION', { granted: microphoneGranted });
    this.sendRaw({ type: 'voice_join' });
  }

  leaveVoice(): void {
    this.voiceRequested = false;
    this.sendRaw({ type: 'voice_leave' });
  }

  close(): void {
    this.send('CLIENT_LEAVE_ROOM');
    this.manuallyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, 'Player left room');
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = window.setInterval(() => this.send('CLIENT_PING', { clientTimestamp: Date.now() }), 15000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.reconnectAttempt += 1;
    const delay = Math.min(1000 * 2 ** Math.min(this.reconnectAttempt, 4), 15000);
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.manuallyClosed) void this.connect().catch(() => undefined);
    }, delay);
  }
}

export function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('room');
  return code?.trim().toUpperCase() || null;
}

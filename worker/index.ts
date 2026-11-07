import { chooseBotMove } from '../src/engine/botEngine';
import { COLOR_ORDER } from '../src/engine/constants';
import { advanceIfStuck, applyMove, createDiceSource, createInitialGameState, forfeitTimedOutTurn, getFairDiceRoll, rollDice } from '../src/engine/gameEngine';
import { DEFAULT_RULES } from '../src/engine/gameEngine';
import type { GameMode, GameRules, GameState, PlayerColor } from '../src/engine/types';
import type { RoomParticipant, RoomSnapshot, ServerMessage } from '../src/network/protocol';

interface Env {
  LUDO_ROOMS: DurableObjectNamespaceLike;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ALLOWED_ORIGINS?: string;
  CREATE_ROOM_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  JOIN_ROOM_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface DurableStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DurableWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface DurableStateLike {
  storage: DurableStorageLike;
  acceptWebSocket(socket: DurableWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): DurableWebSocket[];
}

declare const WebSocketPair: { new (): { 0: WebSocket; 1: DurableWebSocket } };

interface StoredParticipant extends RoomParticipant {
  token: string;
}

interface StoredRoom {
  code: string;
  hostId: string;
  mode: 'classic_4p' | 'team_2v2';
  rules: GameRules;
  participants: StoredParticipant[];
  maxPlayers: number;
  isMatchInProgress: boolean;
  gameState: GameState | null;
  turnDeadline?: number | null;
  rematchRequests?: string[];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_PATTERN = /^LUDO-[A-HJ-NP-Z2-9]{6}$/;
const MAX_BODY_LENGTH = 4096;
const TURN_TIMEOUT_MS = 30_000;

function json(data: unknown, status = 200, origin: string | null = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
  });
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function allowedOrigin(request: Request, env: Env, origin: string): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.origin !== origin || originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false;

  const requestUrl = new URL(request.url);
  if (origin === requestUrl.origin) return true;
  const configuredOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (configuredOrigins.includes(origin)) return true;

  // Permit separate Vite and Worker ports only in local development.
  let requestOrigin: URL;
  try {
    requestOrigin = new URL(requestUrl.origin);
  } catch {
    return false;
  }
  return isLoopback(requestUrl.hostname) && isLoopback(originUrl.hostname) &&
    requestOrigin.protocol === originUrl.protocol;
}

async function rateLimitStatus(
  limiter: Env['CREATE_ROOM_LIMITER'],
  request: Request
): Promise<'limited' | 'unavailable' | null> {
  if (!limiter) return null;
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (!clientIp) return 'unavailable';
  try {
    return (await limiter.limit({ key: clientIp })).success ? null : 'limited';
  } catch {
    return 'unavailable';
  }
}

function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomRoomCode(): string {
  const data = new Uint8Array(6);
  crypto.getRandomValues(data);
  return `LUDO-${Array.from(data, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')}`;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_LENGTH) throw new Error('Request is too large.');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid request body.');
  }
  return parsed as Record<string, unknown>;
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 24;
}

function normalizeRules(value: unknown): GameRules {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RULES };
  const rules = value as Partial<GameRules>;
  return {
    sixToExit: rules.sixToExit ?? DEFAULT_RULES.sixToExit,
    extraTurnOnSix: rules.extraTurnOnSix ?? DEFAULT_RULES.extraTurnOnSix,
    extraTurnOnCapture: rules.extraTurnOnCapture ?? DEFAULT_RULES.extraTurnOnCapture,
    extraTurnOnFinish: rules.extraTurnOnFinish ?? DEFAULT_RULES.extraTurnOnFinish,
    consecutiveSixForfeit: rules.consecutiveSixForfeit ?? DEFAULT_RULES.consecutiveSixForfeit,
    safeStarsActive: rules.safeStarsActive ?? DEFAULT_RULES.safeStarsActive,
    startSquaresAlwaysSafe: rules.startSquaresAlwaysSafe ?? DEFAULT_RULES.startSquaresAlwaysSafe,
    blocksEnabled: rules.blocksEnabled ?? DEFAULT_RULES.blocksEnabled,
    blockStopsPassing: rules.blockStopsPassing ?? DEFAULT_RULES.blockStopsPassing,
    extraTurnOnSixNoMove: rules.extraTurnOnSixNoMove ?? DEFAULT_RULES.extraTurnOnSixNoMove,
    continueUntilRanked: rules.continueUntilRanked ?? DEFAULT_RULES.continueUntilRanked,
  };
}

function roomSnapshot(room: StoredRoom): RoomSnapshot {
  return {
    code: room.code,
    hostId: room.hostId,
    mode: room.mode,
    rules: room.rules,
    participants: room.participants.map(({ token: _token, ...participant }) => participant),
    maxPlayers: room.maxPlayers,
    isMatchInProgress: room.isMatchInProgress,
    rematchRequests: room.rematchRequests ?? [],
  };
}

function createRoomGame(room: StoredRoom): GameState {
  const seed = randomToken(16);
  const state = createInitialGameState({
    id: `room-${room.code}-${seed}`,
    seed,
    mode: room.mode,
    humanColor: 'red',
    customRules: room.rules,
  });
  state.players = state.players.map((player) => {
    const human = room.participants.find((joined) => joined.color === player.color);
    return {
      ...player,
      id: human?.id ?? `bot-${player.color}`,
      name: human?.name ?? `Bot ${player.color.toUpperCase()}`,
      isBot: !human,
      botPersonality: human ? undefined : 'balanced',
    };
  });
  return state;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && !allowedOrigin(request, env, requestOrigin)) {
      return json({ error: 'Origin is not allowed.' }, 403, null);
    }
    const corsOrigin = requestOrigin ?? '*';
    if (request.method === 'OPTIONS') return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'Not found.' }, 404, corsOrigin);
    }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const limitStatus = await rateLimitStatus(env.CREATE_ROOM_LIMITER, request);
      if (limitStatus === 'limited') return json({ error: 'Too many rooms created. Please try again in a minute.' }, 429, corsOrigin);
      if (limitStatus === 'unavailable') return json({ error: 'Room creation is temporarily unavailable. Please try again.' }, 503, corsOrigin);
      try {
        const body = await readJson(request);
        if (!validName(body.playerName)) return json({ error: 'Enter a name up to 24 characters.' }, 400, corsOrigin);
        if (body.mode !== 'classic_4p' && body.mode !== 'team_2v2') {
          return json({ error: 'Choose a supported room mode.' }, 400, corsOrigin);
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const code = randomRoomCode();
          const room = env.LUDO_ROOMS.get(env.LUDO_ROOMS.idFromName(code));
          const response = await room.fetch(new Request('https://room.internal/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, mode: body.mode, playerName: body.playerName.trim(), rules: normalizeRules(body.rules) }),
          }));
          if (response.status !== 409) return json(await response.json(), response.status, corsOrigin);
        }
        return json({ error: 'Could not reserve a room. Please try again.' }, 503, corsOrigin);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Invalid request.' }, 400, corsOrigin);
      }
    }

    const roomRoute = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(join|ws))?$/);
    if (!roomRoute) return json({ error: 'Not found.' }, 404, corsOrigin);
    const code = decodeURIComponent(roomRoute[1]).toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) return json({ error: 'Room code is invalid.' }, 400, corsOrigin);
    const room = env.LUDO_ROOMS.get(env.LUDO_ROOMS.idFromName(code));

    if (roomRoute[2] === 'join' && request.method === 'POST') {
      const limitStatus = await rateLimitStatus(env.JOIN_ROOM_LIMITER, request);
      if (limitStatus === 'limited') return json({ error: 'Too many join attempts. Please wait a minute and try again.' }, 429, corsOrigin);
      if (limitStatus === 'unavailable') return json({ error: 'Joining rooms is temporarily unavailable. Please try again.' }, 503, corsOrigin);
      try {
        const body = await readJson(request);
        if (!validName(body.playerName)) return json({ error: 'Enter a name up to 24 characters.' }, 400, corsOrigin);
        const joinResponse = await room.fetch(new Request('https://room.internal/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName: body.playerName.trim(), token: body.token }),
        }));
        return json(await joinResponse.json(), joinResponse.status, corsOrigin);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Could not join this room.' }, 400, corsOrigin);
      }
    }

    if (roomRoute[2] === 'ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const upstream = await room.fetch(new Request('https://room.internal/ws', request));
      return upstream;
    }

    return json({ error: 'Not found.' }, 404, corsOrigin);
  },
};

export class LudoRoom {
  private room: StoredRoom | null = null;
  private roomLoaded = false;
  private roomLoading: Promise<StoredRoom | null> | null = null;

  constructor(private readonly ctx: DurableStateLike, private readonly env: Env) {}

  private async loadRoom(): Promise<StoredRoom | null> {
    if (this.roomLoaded) return this.room;
    if (!this.roomLoading) {
      this.roomLoading = this.ctx.storage.get<StoredRoom>('room').then((stored) => {
        this.room = stored ?? null;
        this.roomLoaded = true;
        return this.room;
      }).finally(() => {
        this.roomLoading = null;
      });
    }
    return this.roomLoading;
  }

  private async saveRoom(): Promise<void> {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  private send(socket: DurableWebSocket, message: ServerMessage | Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage | Record<string, unknown>): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { participantId?: string | null } | null;
      if (attachment?.participantId && socket.readyState === WebSocket.OPEN) socket.send(serialized);
    }
  }

  private socketsForParticipant(participantId: string): DurableWebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as { participantId?: string | null } | null;
      return attachment?.participantId === participantId;
    });
  }

  private broadcastRoom(): void {
    if (this.room) this.broadcast({ type: 'SERVER_ROOM_STATE', payload: roomSnapshot(this.room) });
  }

  private broadcastGame(): void {
    if (this.room?.gameState) {
      const now = Date.now();
      this.broadcast({
        type: 'SERVER_GAME_STATE_SYNC',
        payload: {
          state: this.room.gameState,
          serverTimestamp: now,
          turnTimeRemainingSeconds: Math.max(0, Math.ceil(((this.room.turnDeadline ?? now + TURN_TIMEOUT_MS) - now) / 1000)),
        },
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/create' && request.method === 'POST') {
      const body = await readJson(request);
      if (await this.loadRoom()) return json({ error: 'Code collision.' }, 409);
      const token = randomToken();
      const host: StoredParticipant = {
        id: crypto.randomUUID(), name: String(body.playerName), color: 'red', isHost: true,
        isReady: true, isBot: false, pingMs: 0, isConnected: false, token,
      };
      this.room = {
        code: String(body.code), hostId: host.id, mode: body.mode as StoredRoom['mode'],
        rules: normalizeRules(body.rules), participants: [host], maxPlayers: 4,
        isMatchInProgress: false, gameState: null, turnDeadline: null, rematchRequests: [],
      };
      await this.saveRoom();
      return json({ roomCode: this.room.code, token, participantId: host.id, room: roomSnapshot(this.room) }, 201);
    }

    const room = await this.loadRoom();
    if (!room) return json({ error: 'Room not found. Check the code or ask the host for a fresh invite.' }, 404);

    if (url.pathname === '/join' && request.method === 'POST') {
      const body = await readJson(request);
      if (typeof body.token === 'string') {
        const returning = room.participants.find((participant) => participant.token === body.token);
        if (returning) {
          returning.name = String(body.playerName);
          returning.isConnected = false;
          await this.saveRoom();
          return json({ roomCode: room.code, participantId: returning.id, token: returning.token, room: roomSnapshot(room) });
        }
      }
      if (room.isMatchInProgress) return json({ error: 'This match has already started. Use the browser that joined before the match began to reconnect.' }, 409);
      if (room.participants.length >= room.maxPlayers) return json({ error: 'This room is full.' }, 409);
      const color = COLOR_ORDER.find((candidate) => !room.participants.some((participant) => participant.color === candidate));
      if (!color) return json({ error: 'This room is full.' }, 409);
      const participant: StoredParticipant = {
        id: crypto.randomUUID(), name: String(body.playerName), color, isHost: false,
        isReady: false, isBot: false, pingMs: 0, isConnected: false, token: randomToken(),
      };
      room.participants.push(participant);
      await this.saveRoom();
      this.broadcastRoom();
      return json({ roomCode: room.code, participantId: participant.id, token: participant.token, room: roomSnapshot(room) }, 201);
    }

    if (url.pathname === '/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ participantId: null });
      return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
    }

    return json({ error: 'Not found.' }, 404);
  }

  async webSocketMessage(socket: DurableWebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const room = await this.loadRoom();
    if (!room) return;
    let message: Record<string, unknown>;
    try {
      const raw = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
      if (raw.length > MAX_BODY_LENGTH) throw new Error('Message too large.');
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'INVALID_MESSAGE', message: 'Message is not valid JSON.' } });
      return;
    }

    const attachment = socket.deserializeAttachment() as { participantId?: string | null } | null;
    if (!attachment?.participantId && message.type === 'CLIENT_AUTH') {
      const payload = message.payload as { token?: unknown } | undefined;
      const participant = typeof payload?.token === 'string'
        ? room.participants.find((candidate) => candidate.token === payload.token)
        : undefined;
      if (!participant) {
        this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'INVALID_TOKEN', message: 'Reconnect token is invalid. Join the room again.' } });
        socket.close(4003, 'Invalid reconnect token.');
        return;
      }
      for (const previousSocket of this.socketsForParticipant(participant.id)) {
        if (previousSocket !== socket) previousSocket.close(4001, 'This player reconnected in another tab.');
      }
      socket.serializeAttachment({ participantId: participant.id });
      participant.isConnected = true;
      await this.saveRoom();
      await this.scheduleBotIfNeeded(false);
      this.send(socket, { type: 'SERVER_AUTHENTICATED', payload: { roomCode: room.code } });
      this.send(socket, { type: 'SERVER_ROOM_STATE', payload: roomSnapshot(room) });
      if (room.gameState) {
        const now = Date.now();
        this.send(socket, {
          type: 'SERVER_GAME_STATE_SYNC',
          payload: {
            state: room.gameState,
            serverTimestamp: now,
            turnTimeRemainingSeconds: Math.max(0, Math.ceil(((room.turnDeadline ?? now + TURN_TIMEOUT_MS) - now) / 1000)),
          },
        });
      }
      this.broadcastRoom();
      return;
    }
    const participant = room.participants.find((candidate) => candidate.id === attachment?.participantId);
    if (!participant) {
      this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'AUTH_REQUIRED', message: 'Authenticate this room connection first.' } });
      socket.close(4003, 'Authentication required.');
      return;
    }

    if (message.type === 'CLIENT_PING') {
      const payload = message.payload as { clientTimestamp?: number } | undefined;
      this.send(socket, { type: 'SERVER_PONG', payload: { clientTimestamp: payload?.clientTimestamp ?? Date.now(), serverTimestamp: Date.now() } });
      return;
    }

    if (message.type === 'CLIENT_LEAVE_ROOM') {
      if (participant.id === room.hostId) {
        for (const peer of this.ctx.getWebSockets()) peer.close(4004, 'The room host ended the room.');
        this.room = null;
        this.roomLoaded = true;
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
      } else {
        room.participants = room.participants.filter((candidate) => candidate.id !== participant.id);
        if (room.gameState && room.gameState.phase !== 'game_over') {
          room.gameState.players = room.gameState.players.map((player) =>
            player.id === participant.id
              ? { ...player, isBot: true, botPersonality: 'balanced' }
              : player
          );
        }
        await this.saveRoom();
        this.broadcastRoom();
        await this.scheduleBotIfNeeded();
        this.broadcastGame();
        socket.close(1000, 'Player left room');
      }
      return;
    }

    if (message.type === 'CLIENT_SET_READY') {
      if (room.isMatchInProgress) return;
      const payload = message.payload as { isReady?: boolean } | undefined;
      participant.isReady = payload?.isReady === true;
      await this.saveRoom();
      this.broadcastRoom();
      return;
    }

    if (message.type === 'CLIENT_START_MATCH') {
      if (participant.id !== room.hostId) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'NOT_HOST', message: 'Only the room host can start the match.' } });
      if (room.isMatchInProgress) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'MATCH_ALREADY_STARTED', message: 'A match is already in progress.' } });
      if (room.participants.length < 2) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'NOT_ENOUGH_PLAYERS', message: 'Invite at least one friend before starting.' } });
      if (room.participants.some((player) => !player.isReady)) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'PLAYERS_NOT_READY', message: 'Wait for every friend to be ready.' } });
      room.gameState = createRoomGame(room);
      room.isMatchInProgress = true;
      room.rematchRequests = [];
      await this.saveRoom();
      await this.scheduleBotIfNeeded();
      this.broadcastRoom();
      this.broadcastGame();
      return;
    }

    if (message.type === 'CLIENT_REQUEST_REMATCH') {
      if (!room.isMatchInProgress || room.gameState?.phase !== 'game_over') {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'MATCH_NOT_FINISHED', message: 'A rematch is available after the match is finished.' } });
      }

      const connectedHumans = room.participants.filter(
        (player) => !player.isBot && (player.isConnected || player.id === participant.id)
      );
      const connectedHumanIds = new Set(connectedHumans.map((player) => player.id));
      const requests = new Set((room.rematchRequests ?? []).filter((id) => connectedHumanIds.has(id)));
      requests.add(participant.id);
      room.rematchRequests = [...requests];
      const allConnectedHumansRequested = connectedHumans.length > 0 &&
        connectedHumans.every((player) => requests.has(player.id));

      if (allConnectedHumansRequested) {
        room.gameState = createRoomGame(room);
        room.rematchRequests = [];
        room.participants = room.participants.map((player) => ({ ...player, isReady: false }));
        room.turnDeadline = null;
      }

      await this.saveRoom();
      this.broadcastRoom();
      if (allConnectedHumansRequested) {
        await this.scheduleBotIfNeeded();
        this.broadcastGame();
      }
      return;
    }

    if (message.type === 'CLIENT_BACK_TO_LOBBY') {
      if (participant.id !== room.hostId) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'NOT_HOST', message: 'Only the room host can return this room to the lobby.' } });
      }
      if (!room.isMatchInProgress || room.gameState?.phase !== 'game_over') {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'MATCH_NOT_FINISHED', message: 'The room can return to the lobby after the match is finished.' } });
      }

      room.isMatchInProgress = false;
      room.gameState = null;
      room.turnDeadline = null;
      room.rematchRequests = [];
      room.participants = room.participants.map((player) => ({ ...player, isReady: false }));
      await this.ctx.storage.deleteAlarm();
      await this.saveRoom();
      this.broadcastRoom();
      return;
    }

    if (message.type === 'CLIENT_ROLL_DICE') {
      const state = room.gameState;
      if (!state || state.phase !== 'rolling' || state.currentTurnColor !== participant.color) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to roll.' } });
      }
      const rolled = rollDice(state, getFairDiceRoll());
      if (!rolled.ok) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: rolled.error, message: 'The dice roll could not be applied.' } });
      room.gameState = rolled.state;
      await this.saveRoom();
      await this.scheduleBotIfNeeded();
      this.broadcastGame();
      return;
    }

    if (message.type === 'CLIENT_SELECT_MOVE') {
      const state = room.gameState;
      const payload = message.payload as { tokenIndex?: number; tokenColor?: PlayerColor } | undefined;
      if (!state || state.phase !== 'moving' || state.currentTurnColor !== participant.color || !Number.isInteger(payload?.tokenIndex)) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'INVALID_MOVE', message: 'This move is not available.' } });
      }
      const result = applyMove(state, { actorColor: participant.color, tokenIndex: payload!.tokenIndex!, tokenColor: payload!.tokenColor });
      if (!result.ok) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: result.error, message: 'Choose one of the highlighted tokens.' } });
      room.gameState = result.state;
      await this.saveRoom();
      await this.scheduleBotIfNeeded();
      this.broadcastGame();
      return;
    }

    this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'UNKNOWN_MESSAGE', message: 'This action is not supported.' } });
  }

  async webSocketClose(socket: DurableWebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as { participantId?: string } | null;
    const room = await this.loadRoom();
    if (attachment?.participantId && this.socketsForParticipant(attachment.participantId).some((active) => active !== socket)) return;
    const participant = room?.participants.find((candidate) => candidate.id === attachment?.participantId);
    if (participant) {
      participant.isConnected = false;
      await this.saveRoom();
      this.broadcastRoom();
      await this.scheduleBotIfNeeded(false);
    }
  }

  async webSocketError(socket: DurableWebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const room = await this.loadRoom();
    const state = room?.gameState;
    if (!room || !state || state.phase === 'game_over') return;
    // Older persisted rooms may not have a deadline yet. Start their timer
    // instead of treating a missing deadline as an expired human turn.
    if (room.turnDeadline === null || room.turnDeadline === undefined) {
      await this.scheduleBotIfNeeded();
      return;
    }
    if (room.turnDeadline !== null && room.turnDeadline !== undefined && room.turnDeadline > Date.now()) {
      await this.ctx.storage.setAlarm(room.turnDeadline);
      return;
    }
    const player = state.players.find((candidate) => candidate.color === state.currentTurnColor);

    if (state.phase === 'moving' && state.legalMoves.length === 0) {
      const advanced = advanceIfStuck(state);
      if (advanced.ok) room.gameState = advanced.state;
    } else if (!player?.isBot) {
      const advanced = forfeitTimedOutTurn(state);
      if (advanced.ok) room.gameState = advanced.state;
      await this.saveRoom();
      await this.scheduleBotIfNeeded();
      this.broadcastGame();
      this.broadcast({ type: 'SERVER_TURN_TIMEOUT', payload: { timedOutColor: state.currentTurnColor } });
      return;
    } else if (state.phase === 'rolling') {
      const rolled = rollDice(state, getFairDiceRoll());
      if (!rolled.ok) return;
      room.gameState = rolled.state;
    } else {
      const move = chooseBotMove(state.legalMoves, player, state.players, state.rules, state.isTeamMode, createDiceSource(`${state.seed}:${state.nextEventId}`));
      if (move) {
        const applied = applyMove(state, { actorColor: player.color, tokenIndex: move.tokenIndex, tokenColor: move.tokenColor });
        if (applied.ok) room.gameState = applied.state;
      }
    }
    await this.saveRoom();
    await this.scheduleBotIfNeeded();
    this.broadcastGame();
  }

  private async scheduleBotIfNeeded(resetDeadline = true): Promise<void> {
    const room = this.room;
    const state = room?.gameState;
    if (!room || !state || state.phase === 'game_over') {
      if (room) room.turnDeadline = null;
      await this.ctx.storage.deleteAlarm();
      return;
    }
    let delayMs = TURN_TIMEOUT_MS;
    if (state.phase === 'moving' && state.legalMoves.length === 0) delayMs = 900;
    else if (state.players.find((candidate) => candidate.color === state.currentTurnColor)?.isBot) delayMs = 700;
    if (resetDeadline || room.turnDeadline === null || room.turnDeadline === undefined) {
      room.turnDeadline = Date.now() + delayMs;
      await this.saveRoom();
    }
    await this.ctx.storage.setAlarm(room.turnDeadline);
  }
}

import { chooseBotMove } from '../src/engine/botEngine';
import { createSeededRandom, getBotThinkingDelayMs } from '../src/engine/botRandom';
import { COLOR_ORDER, COLOR_TEAMS } from '../src/engine/constants';
import { advanceIfStuck, applyMove, createDiceSource, createInitialGameState, forfeitTimedOutTurn, getFairDiceRoll, rollDice } from '../src/engine/gameEngine';
import { DEFAULT_RULES } from '../src/engine/gameEngine';
import type { GameMode, GameRules, GameState, PlayerColor } from '../src/engine/types';
import type { ChatMessage, ChatReaction, OnlineTokenMove, RoomParticipant, RoomSnapshot, ServerMessage } from '../src/network/protocol';
import { handleGuestAuth, handleGoogleAuthStart, handleGoogleAuthCallback, handleLogout, handleGetMe, handleUpdateMe, handleDeleteMe, handleGetPublicProfile, handleGetLeaderboard } from './routes/authRoutes';
import type { D1Database } from '@cloudflare/workers-types';

export { VoiceBudget } from './voiceBudget';

interface Env {
  LUDO_ROOMS: DurableObjectNamespaceLike;
  VOICE_BUDGET?: DurableObjectNamespaceLike;
  DB?: D1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ALLOWED_ORIGINS?: string;
  CHAT_ENABLED?: string;
  VOICE_ENABLED?: string;
  CF_ACCOUNT_ID?: string;
  REALTIMEKIT_APP_ID?: string;
  REALTIMEKIT_API_TOKEN?: string;
  REALTIMEKIT_VOICE_PRESET?: string;
  VOICE_MONTHLY_MINUTE_LIMIT?: string;
  VOICE_BUDGET_ADMIN_SECRET?: string;
  ACCOUNTS_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
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
  userId?: string;
}

interface StoredVoiceParticipant {
  seatId: string;
  color: PlayerColor;
  participantId: string;
  joinedAt: number;
  leaving?: boolean;
}

interface VoiceBudgetSnapshot {
  month: string;
  limitMinutes: number;
  usedMinutes: number;
  activeMinutes: number;
  totalMinutes: number;
  warning: boolean;
}

class VoiceRequestError extends Error {
  constructor(readonly status?: number) {
    super('Voice service request failed.');
  }
}

type VoiceClientErrorCode =
  | 'VOICE_DISABLED'
  | 'VOICE_BUDGET_REACHED'
  | 'VOICE_ROOM_FULL'
  | 'VOICE_UNAVAILABLE'
  | 'VOICE_NOT_ALLOWED'
  | 'VOICE_RATE_LIMITED';

class VoiceJoinError extends Error {
  constructor(readonly code: VoiceClientErrorCode, readonly retryAfterSeconds?: number) {
    super(code);
  }
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
  teamSwapRequest?: { id: string; requesterId: string; targetId: string; expiresAt: number } | null;
  chatEnabled?: boolean;
  voiceEnabled?: boolean;
  voiceMeetingId?: string;
  voiceParticipants?: StoredVoiceParticipant[];
  voiceCheckpointAt?: number | null;
  voiceBudgetWarningMonth?: string;
  voiceClosing?: boolean;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_PATTERN = /^LUDO-[A-HJ-NP-Z2-9]{6}$/;
const MAX_BODY_LENGTH = 4096;
const TURN_TIMEOUT_MS = 30_000;
const TEAM_SWAP_REQUEST_TIMEOUT_MS = 30_000;
const CHAT_HISTORY_LIMIT = 50;
const CHAT_RATE_WINDOW_MS = 10_000;
const CHAT_RATE_LIMIT = 5;
const CHAT_MAX_CODE_POINTS = 200;
const VOICE_ROOM_LIMIT = 4;
const VOICE_JOIN_RATE_LIMIT = 5;
const VOICE_JOIN_RATE_WINDOW_MS = 60_000;
const VOICE_SESSION_LIMIT_MS = 3 * 60 * 60 * 1000;
const VOICE_CHECKPOINT_MS = 60_000;
const REALTIMEKIT_API_BASE = 'https://api.cloudflare.com/client/v4';
const CHAT_REACTION_TEXT: Record<ChatReaction, string> = {
  thumbs_up: '👍',
  laugh: '😂',
  wow: '😮',
  angry: '😠',
  party: '🎉',
  gg: 'GG',
};
const CHAT_CONTROL_AND_ZERO_WIDTH = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;

function json(data: unknown, status = 200, origin: string | null = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    },
  });
}

function matchesSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = providedBytes.length ^ expectedBytes.length;
  const maxLength = Math.max(providedBytes.length, expectedBytes.length);
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
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

function roomSnapshot(room: StoredRoom, env?: Env): RoomSnapshot {
  return {
    code: room.code,
    hostId: room.hostId,
    mode: room.mode,
    rules: room.rules,
    participants: room.participants.map(({ token: _token, ...participant }) => participant),
    maxPlayers: room.maxPlayers,
    isMatchInProgress: room.isMatchInProgress,
    rematchRequests: room.rematchRequests ?? [],
    teamSwapRequest: room.teamSwapRequest ?? null,
    chatEnabled: env?.CHAT_ENABLED !== 'false' && room.chatEnabled !== false,
    voiceEnabled: room.voiceEnabled !== false,
    voiceAvailable: Boolean(env && env.VOICE_ENABLED !== 'false' && isVoiceConfigured(env) && voiceMonthlyLimit(env) !== null),
    seatsInVoice: (room.voiceParticipants ?? []).map((voiceParticipant) => voiceParticipant.color),
  };
}

function normalizeChatText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/\s+/gu, ' ')
    .replace(CHAT_CONTROL_AND_ZERO_WIDTH, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text || Array.from(text).length > CHAT_MAX_CODE_POINTS) return null;
  return text;
}

function isChatReaction(value: unknown): value is ChatReaction {
  return typeof value === 'string' && Object.hasOwn(CHAT_REACTION_TEXT, value);
}

function isVoiceConfigured(env: Env): boolean {
  return Boolean(env.VOICE_BUDGET && env.CF_ACCOUNT_ID && env.REALTIMEKIT_APP_ID &&
    env.REALTIMEKIT_API_TOKEN && env.REALTIMEKIT_VOICE_PRESET
  );
}

function voiceMonthlyLimit(env: Env): number | null {
  if (env.VOICE_MONTHLY_MINUTE_LIMIT === undefined) return 8000;
  if (!/^[1-9]\d*$/.test(env.VOICE_MONTHLY_MINUTE_LIMIT)) return null;
  const limit = Number(env.VOICE_MONTHLY_MINUTE_LIMIT);
  return Number.isSafeInteger(limit) ? limit : null;
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
      teamId: room.mode === 'team_2v2' ? (human?.teamId ?? COLOR_TEAMS[player.color]) : undefined,
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });

    const url = new URL(request.url);

    // Auth routes
    if (url.pathname === '/api/auth/guest' && request.method === 'POST') {
      return handleGuestAuth(request, env);
    }
    if (url.pathname === '/api/auth/google/start' && request.method === 'GET') {
      return handleGoogleAuthStart(request, env);
    }
    if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
      return handleGoogleAuthCallback(request, env);
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return handleGetMe(request, env);
    }
    if (url.pathname === '/api/me' && request.method === 'PATCH') {
      return handleUpdateMe(request, env);
    }
    if (url.pathname === '/api/me' && request.method === 'DELETE') {
      return handleDeleteMe(request, env);
    }
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return handleGetLeaderboard(request, env);
    }
    const profileMatch = url.pathname.match(/^\/api\/profile\/([^/]+)$/);
    if (profileMatch && request.method === 'GET') {
      return handleGetPublicProfile(decodeURIComponent(profileMatch[1]), env);
    }

    if (url.pathname === '/api/admin/voice-budget') {
      if (request.method !== 'GET') return json({ error: 'Not found.' }, 404, corsOrigin);
      if (!env.VOICE_BUDGET || !env.VOICE_BUDGET_ADMIN_SECRET) {
        return json({ error: 'Voice budget reporting is unavailable.' }, 503, corsOrigin);
      }
      const authorization = request.headers.get('Authorization');
      const providedSecret = authorization ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? null : null;
      if (!matchesSecret(providedSecret, env.VOICE_BUDGET_ADMIN_SECRET)) {
        return json({ error: 'Unauthorized.' }, 401, corsOrigin);
      }
      const limitMinutes = voiceMonthlyLimit(env);
      if (limitMinutes === null) return json({ error: 'Voice budget configuration is invalid.' }, 503, corsOrigin);
      try {
        const id = env.VOICE_BUDGET.idFromName('global');
        const budgetResponse = await env.VOICE_BUDGET.get(id).fetch(
          new Request(`https://voice-budget.internal/snapshot?limitMinutes=${limitMinutes}`)
        );
        if (!budgetResponse.ok) return json({ error: 'Voice budget reporting is unavailable.' }, 503, corsOrigin);
        return json(await budgetResponse.json(), 200, corsOrigin);
      } catch {
        return json({ error: 'Voice budget reporting is unavailable.' }, 503, corsOrigin);
      }
    }
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
  private readonly chatMessages: ChatMessage[] = [];
  private readonly chatSentAt = new WeakMap<DurableWebSocket, number[]>();
  private readonly chatCooldownUntil = new WeakMap<DurableWebSocket, number>();
  private readonly voiceJoinTimes = new WeakMap<DurableWebSocket, number[]>();
  private readonly voiceJoinPromises = new Map<string, Promise<void>>();
  private readonly cancelledVoiceJoins = new Set<string>();
  private readonly voiceTokens = new Map<string, string>();
  private voiceMeetingPromise: Promise<string> | null = null;

  constructor(private readonly ctx: DurableStateLike, private readonly env: Env) {}

  private async loadRoom(): Promise<StoredRoom | null> {
    if (this.roomLoaded) return this.room;
    if (!this.roomLoading) {
      this.roomLoading = this.ctx.storage.get<StoredRoom>('room').then((stored) => {
        this.room = stored ?? null;
        if (this.room) {
          this.room.voiceEnabled ??= true;
          this.room.voiceParticipants ??= [];
        }
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

  private sendChatError(socket: DurableWebSocket, code: 'CHAT_RATE_LIMITED' | 'CHAT_INVALID' | 'CHAT_DISABLED', retryAfterSeconds?: number): void {
    this.send(socket, {
      type: 'error',
      code,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    });
  }

  private sendVoiceError(socket: DurableWebSocket, code: VoiceClientErrorCode, retryAfterSeconds?: number): void {
    this.send(socket, {
      type: 'error',
      code,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    });
  }

  private voiceSessionId(seatId: string): string {
    return `${this.room!.code}:${seatId}`;
  }

  private async requestVoiceBudget(
    path: '/reserve' | '/checkpoint' | '/leave' | '/snapshot',
    seatId?: string
  ): Promise<{ ok?: boolean; code?: string; snapshot?: VoiceBudgetSnapshot }> {
    const namespace = this.env.VOICE_BUDGET;
    const limitMinutes = voiceMonthlyLimit(this.env);
    if (!namespace || limitMinutes === null) throw new VoiceRequestError();
    const method = path === '/snapshot' ? 'GET' : 'POST';
    const response = await namespace.get(namespace.idFromName('global')).fetch(new Request(
      `https://voice-budget.internal${path}?limitMinutes=${limitMinutes}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ sessionId: this.voiceSessionId(seatId ?? '') }) } : {}),
      }
    ));
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new VoiceRequestError(response.status);
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new VoiceRequestError(response.status);
    const data = result as Record<string, unknown>;
    if (!response.ok && response.status !== 429) throw new VoiceRequestError(response.status);
    const snapshot = data.snapshot;
    return {
      ...(typeof data.ok === 'boolean' ? { ok: data.ok } : {}),
      ...(typeof data.code === 'string' ? { code: data.code } : {}),
      ...(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? { snapshot: snapshot as VoiceBudgetSnapshot }
        : {}),
    };
  }

  private async reportVoiceBudgetWarning(snapshot?: VoiceBudgetSnapshot): Promise<void> {
    if (!snapshot?.warning || this.room?.voiceBudgetWarningMonth === snapshot.month) return;
    this.room!.voiceBudgetWarningMonth = snapshot.month;
    await this.saveRoom();
    this.broadcast({
      type: 'voice_budget_warning',
      payload: { month: snapshot.month, totalMinutes: snapshot.totalMinutes, limitMinutes: snapshot.limitMinutes },
    });
  }

  private broadcastVoiceStatus(): void {
    if (!this.room) return;
    const seatsInVoice = [...new Set((this.room.voiceParticipants ?? []).map((voiceParticipant) => voiceParticipant.color))];
    this.broadcastRoom();
    this.broadcast({ type: 'voice_status', seatsInVoice });
  }

  private async realtimeRequest(path: string, method: 'POST' | 'DELETE', body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.env.CF_ACCOUNT_ID || !this.env.REALTIMEKIT_APP_ID || !this.env.REALTIMEKIT_API_TOKEN) {
      throw new VoiceRequestError();
    }
    const url = `${REALTIMEKIT_API_BASE}/accounts/${encodeURIComponent(this.env.CF_ACCOUNT_ID)}/realtime/kit/${encodeURIComponent(this.env.REALTIMEKIT_APP_ID)}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.env.REALTIMEKIT_API_TOKEN}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new VoiceRequestError();
    }
    if (!response.ok) throw new VoiceRequestError(response.status);
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new VoiceRequestError(response.status);
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new VoiceRequestError(response.status);
    const data = result as Record<string, unknown>;
    if (data.success === false) throw new VoiceRequestError(response.status);
    return data;
  }

  private async ensureVoiceMeeting(): Promise<string> {
    if (this.room?.voiceMeetingId) return this.room.voiceMeetingId;
    if (!this.voiceMeetingPromise) {
      this.voiceMeetingPromise = (async () => {
        const result = await this.realtimeRequest('/meetings', 'POST', { title: `Ludo room ${this.room!.code}` });
        const data = result.data;
        const meetingId = data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>).id
          : undefined;
        if (typeof meetingId !== 'string' || meetingId.length === 0) throw new VoiceRequestError();
        this.room!.voiceMeetingId = meetingId;
        await this.saveRoom();
        return meetingId;
      })();
    }
    const pending = this.voiceMeetingPromise;
    try {
      return await pending;
    } finally {
      if (this.voiceMeetingPromise === pending) this.voiceMeetingPromise = null;
    }
  }

  private async addVoiceParticipant(
    meetingId: string,
    participant: StoredParticipant
  ): Promise<{ participantId: string; authToken: string }> {
    const result = await this.realtimeRequest(
      `/meetings/${encodeURIComponent(meetingId)}/participants`,
      'POST',
      {
        name: participant.name,
        custom_participant_id: participant.id,
        preset_name: this.env.REALTIMEKIT_VOICE_PRESET,
      }
    );
    const data = result.data;
    const record = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null;
    if (record && typeof record.id === 'string' && typeof record.token !== 'string') {
      try {
        await this.deleteVoiceParticipant(meetingId, record.id);
      } catch {
        console.error('RealtimeKit participant cleanup failed after an invalid response.');
      }
    }
    if (!record || typeof record.id !== 'string' || typeof record.token !== 'string') {
      throw new VoiceRequestError();
    }
    return { participantId: record.id, authToken: record.token };
  }

  private async deleteVoiceParticipant(meetingId: string, participantId: string): Promise<void> {
    if (!this.env.CF_ACCOUNT_ID || !this.env.REALTIMEKIT_APP_ID || !this.env.REALTIMEKIT_API_TOKEN) {
      throw new VoiceRequestError();
    }
    const url = `${REALTIMEKIT_API_BASE}/accounts/${encodeURIComponent(this.env.CF_ACCOUNT_ID)}/realtime/kit/${encodeURIComponent(this.env.REALTIMEKIT_APP_ID)}/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.env.REALTIMEKIT_API_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new VoiceRequestError();
    }
    if (!response.ok && response.status !== 404) throw new VoiceRequestError(response.status);
  }

  private async handleVoiceJoin(socket: DurableWebSocket, participant: StoredParticipant): Promise<void> {
    this.cancelledVoiceJoins.delete(participant.id);
    const pending = this.voiceJoinPromises.get(participant.id);
    if (pending) {
      try {
        await pending;
        const authToken = this.voiceTokens.get(participant.id);
        if (authToken) this.send(socket, { type: 'voice_token', authToken });
      } catch (error) {
        this.sendVoiceError(socket, error instanceof VoiceJoinError ? error.code : 'VOICE_UNAVAILABLE',
          error instanceof VoiceJoinError ? error.retryAfterSeconds : undefined);
      }
      return;
    }
    const join = this.joinVoice(socket, participant);
    this.voiceJoinPromises.set(participant.id, join);
    try {
      await join;
    } catch (error) {
      this.sendVoiceError(socket, error instanceof VoiceJoinError ? error.code : 'VOICE_UNAVAILABLE',
        error instanceof VoiceJoinError ? error.retryAfterSeconds : undefined);
    } finally {
      if (this.voiceJoinPromises.get(participant.id) === join) this.voiceJoinPromises.delete(participant.id);
    }
  }

  private voiceRoomAllowsJoin(room: StoredRoom): boolean {
    return room.voiceEnabled !== false && !room.voiceClosing && this.env.VOICE_ENABLED !== 'false';
  }

  private async joinVoice(socket: DurableWebSocket, participant: StoredParticipant): Promise<void> {
    const room = this.room!;
    if (!this.voiceRoomAllowsJoin(room)) throw new VoiceJoinError('VOICE_DISABLED');
    if (!isVoiceConfigured(this.env) || voiceMonthlyLimit(this.env) === null) throw new VoiceJoinError('VOICE_UNAVAILABLE');
    if (participant.isBot) throw new VoiceJoinError('VOICE_NOT_ALLOWED');

    const now = Date.now();
    const recent = (this.voiceJoinTimes.get(socket) ?? []).filter((joinedAt) => now - joinedAt < VOICE_JOIN_RATE_WINDOW_MS);
    if (recent.length >= VOICE_JOIN_RATE_LIMIT) {
      throw new VoiceJoinError('VOICE_RATE_LIMITED', Math.max(1, Math.ceil((recent[0] + VOICE_JOIN_RATE_WINDOW_MS - now) / 1000)));
    }
    recent.push(now);
    this.voiceJoinTimes.set(socket, recent);

    const existing = (room.voiceParticipants ?? []).find((voiceParticipant) => voiceParticipant.seatId === participant.id);
    if (existing && !existing.leaving && this.voiceTokens.has(participant.id)) {
      this.send(socket, { type: 'voice_token', authToken: this.voiceTokens.get(participant.id)! });
      return;
    }
    if (!existing && new Set((room.voiceParticipants ?? []).map((voiceParticipant) => voiceParticipant.seatId)).size >= VOICE_ROOM_LIMIT) {
      throw new VoiceJoinError('VOICE_ROOM_FULL');
    }

    if (!existing) {
      let budget: Awaited<ReturnType<LudoRoom['requestVoiceBudget']>>;
      try {
        budget = await this.requestVoiceBudget('/reserve', participant.id);
      } catch {
        throw new VoiceJoinError('VOICE_UNAVAILABLE');
      }
      if (budget.code === 'VOICE_BUDGET_REACHED') throw new VoiceJoinError('VOICE_BUDGET_REACHED');
      if (budget.ok !== true) throw new VoiceJoinError('VOICE_UNAVAILABLE');
      await this.reportVoiceBudgetWarning(budget.snapshot);
    }

    let meetingId: string;
    let created: { participantId: string; authToken: string };
    try {
      meetingId = await this.ensureVoiceMeeting();
      if (existing) await this.deleteVoiceParticipant(meetingId, existing.participantId);
      created = await this.addVoiceParticipant(meetingId, participant);
    } catch {
      if (existing) {
        existing.leaving = true;
        await this.saveRoom();
        if (!(await this.leaveVoiceSeat(participant.id))) {
          console.warn('Existing RealtimeKit participant cleanup failed after a rejoin failure.');
        }
      } else {
        try {
          await this.requestVoiceBudget('/leave', participant.id);
        } catch {
          console.error('Voice budget reservation cleanup failed.');
        }
      }
      throw new VoiceJoinError('VOICE_UNAVAILABLE');
    }
    const currentParticipant = room.participants.find((candidate) => candidate.id === participant.id);
    if (this.room !== room || !this.voiceRoomAllowsJoin(room) || this.cancelledVoiceJoins.has(participant.id) ||
      !currentParticipant?.isConnected) {
      if (existing) {
        existing.participantId = created.participantId;
        existing.leaving = true;
      } else {
        room.voiceParticipants ??= [];
        room.voiceParticipants.push({
          seatId: participant.id,
          color: participant.color,
          participantId: created.participantId,
          joinedAt: now,
          leaving: true,
        });
        room.voiceCheckpointAt ??= now;
      }
      await this.saveRoom();
      await this.scheduleRoomAlarm();
      await this.leaveVoiceSeat(participant.id);
      throw new VoiceJoinError('VOICE_DISABLED');
    }
    if (existing) {
      existing.participantId = created.participantId;
      existing.leaving = false;
    } else {
      room.voiceParticipants ??= [];
      room.voiceParticipants.push({
        seatId: participant.id,
        color: participant.color,
        participantId: created.participantId,
        joinedAt: now,
      });
      room.voiceCheckpointAt ??= now;
    }
    await this.saveRoom();
    await this.scheduleRoomAlarm();
    let budgetCheckpoint: Awaited<ReturnType<LudoRoom['requestVoiceBudget']>>;
    try {
      budgetCheckpoint = await this.requestVoiceBudget('/checkpoint', participant.id);
    } catch {
      await this.leaveVoiceSeat(participant.id);
      throw new VoiceJoinError('VOICE_UNAVAILABLE');
    }
    if (budgetCheckpoint.ok !== true) {
      await this.leaveVoiceSeat(participant.id);
      throw new VoiceJoinError('VOICE_UNAVAILABLE');
    }
    await this.reportVoiceBudgetWarning(budgetCheckpoint.snapshot);
    if (this.room !== room || !this.voiceRoomAllowsJoin(room) || this.cancelledVoiceJoins.has(participant.id) ||
      !room.participants.find((candidate) => candidate.id === participant.id)?.isConnected) {
      await this.leaveVoiceSeat(participant.id);
      throw new VoiceJoinError('VOICE_DISABLED');
    }
    this.voiceTokens.set(participant.id, created.authToken);
    this.broadcastVoiceStatus();
    this.send(socket, { type: 'voice_token', authToken: created.authToken });
    await this.scheduleRoomAlarm();
  }

  private async leaveVoiceSeat(seatId: string): Promise<boolean> {
    const room = this.room;
    const voiceParticipant = room?.voiceParticipants?.find((candidate) => candidate.seatId === seatId);
    if (!room || !voiceParticipant) return true;
    if (!room.voiceMeetingId) return false;
    room.voiceParticipants ??= [];
    voiceParticipant.leaving = true;
    this.voiceTokens.delete(seatId);
    await this.saveRoom();
    try {
      await this.deleteVoiceParticipant(room.voiceMeetingId, voiceParticipant.participantId);
      await this.requestVoiceBudget('/leave', seatId);
    } catch {
      return false;
    }
    room.voiceParticipants = room.voiceParticipants.filter((candidate) => candidate.seatId !== seatId);
    this.voiceTokens.delete(seatId);
    if (room.voiceParticipants.length === 0) room.voiceCheckpointAt = null;
    await this.saveRoom();
    this.broadcastVoiceStatus();
    await this.scheduleRoomAlarm();
    return true;
  }

  private async leaveAllVoice(): Promise<boolean> {
    await Promise.allSettled([...this.voiceJoinPromises.values()]);
    const seatIds = (this.room?.voiceParticipants ?? []).map((voiceParticipant) => voiceParticipant.seatId);
    let success = true;
    for (const seatId of seatIds) {
      if (!(await this.leaveVoiceSeat(seatId))) success = false;
    }
    return success;
  }

  private async checkpointVoiceSessions(now: number): Promise<void> {
    const room = this.room;
    if (!room?.voiceParticipants?.length) return;
    let allCheckpointsSucceeded = true;
    for (const voiceParticipant of [...room.voiceParticipants]) {
      const roomParticipant = room.participants.find((candidate) => candidate.id === voiceParticipant.seatId);
      if (room.voiceClosing || room.voiceEnabled === false || this.env.VOICE_ENABLED === 'false' ||
        voiceParticipant.leaving || !roomParticipant?.isConnected) {
        const left = await this.leaveVoiceSeat(voiceParticipant.seatId);
        if (!left) allCheckpointsSucceeded = false;
        continue;
      }
      if (now - voiceParticipant.joinedAt >= VOICE_SESSION_LIMIT_MS) {
        const left = await this.leaveVoiceSeat(voiceParticipant.seatId);
        if (left) {
          for (const socket of this.socketsForParticipant(voiceParticipant.seatId)) {
            this.send(socket, { type: 'voice_session_expired' });
          }
        } else {
          allCheckpointsSucceeded = false;
        }
        continue;
      }
      try {
        const budget = await this.requestVoiceBudget('/checkpoint', voiceParticipant.seatId);
        await this.reportVoiceBudgetWarning(budget.snapshot);
        if (budget.snapshot && budget.snapshot.totalMinutes >= budget.snapshot.limitMinutes) {
          if (!(await this.leaveAllVoice())) console.warn('Voice budget limit reached; one or more sessions need cleanup.');
          return;
        }
      } catch {
        allCheckpointsSucceeded = false;
      }
    }
    if (room.voiceParticipants?.length) {
      room.voiceCheckpointAt = now;
      await this.saveRoom();
    }
    if (!allCheckpointsSucceeded) console.warn('One or more voice sessions need cleanup or a budget retry.');
  }

  private async scheduleRoomAlarm(): Promise<void> {
    const room = this.room;
    if (!room) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const deadlines: number[] = [];
    if (room.gameState && room.gameState.phase !== 'game_over' && room.turnDeadline != null) {
      deadlines.push(room.turnDeadline);
    }
    if (room.teamSwapRequest) deadlines.push(room.teamSwapRequest.expiresAt);
    if (room.voiceParticipants?.length) {
      const now = Date.now();
      deadlines.push((room.voiceCheckpointAt ?? now) + VOICE_CHECKPOINT_MS);
      for (const voiceParticipant of room.voiceParticipants) {
        deadlines.push(voiceParticipant.joinedAt + VOICE_SESSION_LIMIT_MS);
      }
    }
    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  private handleChat(socket: DurableWebSocket, participant: StoredParticipant, message: Record<string, unknown>): void {
    if (this.env.CHAT_ENABLED === 'false' || this.room?.chatEnabled === false) {
      this.sendChatError(socket, 'CHAT_DISABLED');
      return;
    }
    if (participant.isBot) {
      this.sendChatError(socket, 'CHAT_INVALID');
      return;
    }

    let text: string | null;
    let reaction: ChatReaction | undefined;
    if (message.type === 'chat') {
      text = normalizeChatText(message.text);
    } else if (isChatReaction(message.reaction)) {
      reaction = message.reaction;
      text = CHAT_REACTION_TEXT[reaction];
    } else {
      text = null;
    }
    if (!text) {
      this.sendChatError(socket, 'CHAT_INVALID');
      return;
    }

    const now = Date.now();
    const recent = (this.chatSentAt.get(socket) ?? []).filter((sentAt) => now - sentAt < CHAT_RATE_WINDOW_MS);
    const cooldownUntil = this.chatCooldownUntil.get(socket) ?? 0;
    if (recent.length >= CHAT_RATE_LIMIT || now < cooldownUntil) {
      const retryAt = recent.length >= CHAT_RATE_LIMIT ? recent[0] + CHAT_RATE_WINDOW_MS : cooldownUntil;
      const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
      this.chatCooldownUntil.set(socket, Math.max(retryAt, now + 1000));
      this.chatSentAt.set(socket, recent);
      this.sendChatError(socket, 'CHAT_RATE_LIMITED', retryAfterSeconds);
      return;
    }

    recent.push(now);
    this.chatSentAt.set(socket, recent);
    this.chatCooldownUntil.delete(socket);
    const chatMessage: ChatMessage = {
      id: crypto.randomUUID(),
      color: participant.color,
      name: participant.name,
      text,
      sentAt: now,
      ...(reaction ? { reaction } : {}),
    };
    this.chatMessages.push(chatMessage);
    if (this.chatMessages.length > CHAT_HISTORY_LIMIT) this.chatMessages.shift();
    this.broadcast({ type: 'chat', message: chatMessage });
  }

  private socketsForParticipant(participantId: string): DurableWebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as { participantId?: string | null } | null;
      return attachment?.participantId === participantId;
    });
  }

  private broadcastRoom(): void {
    if (this.room) this.broadcast({ type: 'SERVER_ROOM_STATE', payload: roomSnapshot(this.room, this.env) });
  }

  private broadcastGame(move?: OnlineTokenMove): void {
    if (this.room?.gameState) {
      const now = Date.now();
      this.broadcast({
        type: 'SERVER_GAME_STATE_SYNC',
        payload: {
          state: this.room.gameState,
          ...(move ? { move } : {}),
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
        isMatchInProgress: false, gameState: null, turnDeadline: null, rematchRequests: [], teamSwapRequest: null,
        chatEnabled: true, voiceEnabled: true, voiceParticipants: [], voiceCheckpointAt: null,
        ...(body.mode === 'team_2v2' ? { participants: [{ ...host, teamId: COLOR_TEAMS[host.color] }] } : {}),
      };
      await this.saveRoom();
      return json({ roomCode: this.room.code, token, participantId: host.id, room: roomSnapshot(this.room, this.env) }, 201);
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
          return json({ roomCode: room.code, participantId: returning.id, token: returning.token, room: roomSnapshot(room, this.env) });
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
      if (room.mode === 'team_2v2') participant.teamId = COLOR_TEAMS[color];
      room.participants.push(participant);
      await this.saveRoom();
      this.broadcastRoom();
      return json({ roomCode: room.code, participantId: participant.id, token: participant.token, room: roomSnapshot(room, this.env) }, 201);
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
    const raw = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_LENGTH) {
      this.sendChatError(socket, 'CHAT_INVALID');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Message must be an object.');
      message = parsed as Record<string, unknown>;
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
      this.send(socket, { type: 'SERVER_ROOM_STATE', payload: roomSnapshot(room, this.env) });
      this.send(socket, {
        type: 'chat_history',
        messages: this.env.CHAT_ENABLED === 'false' || room.chatEnabled === false ? [] : this.chatMessages.slice(),
      });
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

    if (message.type === 'chat' || message.type === 'chat_reaction') {
      this.handleChat(socket, participant, message);
      return;
    }

    if (message.type === 'CLIENT_SET_CHAT_ENABLED') {
      const payload = message.payload as { enabled?: unknown } | undefined;
      if (participant.id !== room.hostId) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'NOT_HOST', message: 'Only the room host can change chat settings.' } });
      }
      if (typeof payload?.enabled !== 'boolean') {
        this.sendChatError(socket, 'CHAT_INVALID');
        return;
      }
      room.chatEnabled = payload.enabled;
      await this.saveRoom();
      this.broadcastRoom();
      if (this.env.CHAT_ENABLED !== 'false' && room.chatEnabled) {
        const history = { type: 'chat_history', messages: this.chatMessages.slice() };
        for (const peer of this.ctx.getWebSockets()) {
          const peerAttachment = peer.deserializeAttachment() as { participantId?: string | null } | null;
          if (peerAttachment?.participantId) this.send(peer, history);
        }
      }
      return;
    }

    if (message.type === 'voice_join') {
      await this.handleVoiceJoin(socket, participant);
      return;
    }

    if (message.type === 'voice_leave') {
      this.cancelledVoiceJoins.add(participant.id);
      if (!(await this.leaveVoiceSeat(participant.id))) this.sendVoiceError(socket, 'VOICE_UNAVAILABLE');
      return;
    }

    if (message.type === 'CLIENT_SET_VOICE_ENABLED') {
      const payload = message.payload as { enabled?: unknown } | undefined;
      if (participant.id !== room.hostId) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'NOT_HOST', message: 'Only the room host can change voice settings.' } });
      }
      if (typeof payload?.enabled !== 'boolean') {
        this.sendVoiceError(socket, 'VOICE_UNAVAILABLE');
        return;
      }
      room.voiceEnabled = payload.enabled;
      if (payload.enabled) room.voiceClosing = false;
      if (!payload.enabled) {
        for (const seatId of this.voiceJoinPromises.keys()) this.cancelledVoiceJoins.add(seatId);
        const stopped = await this.leaveAllVoice();
        if (!stopped) this.sendVoiceError(socket, 'VOICE_UNAVAILABLE');
      }
      await this.saveRoom();
      this.broadcastRoom();
      return;
    }

    if (message.type === 'CLIENT_PING') {
      const payload = message.payload as { clientTimestamp?: number } | undefined;
      this.send(socket, { type: 'SERVER_PONG', payload: { clientTimestamp: payload?.clientTimestamp ?? Date.now(), serverTimestamp: Date.now() } });
      return;
    }

    if (message.type === 'CLIENT_LEAVE_ROOM') {
      if (participant.id === room.hostId) {
        room.voiceClosing = true;
        for (const seatId of this.voiceJoinPromises.keys()) this.cancelledVoiceJoins.add(seatId);
        await this.saveRoom();
        if (!(await this.leaveAllVoice())) {
          this.sendVoiceError(socket, 'VOICE_UNAVAILABLE');
          return;
        }
        for (const peer of this.ctx.getWebSockets()) peer.close(4004, 'The room host ended the room.');
        this.room = null;
        this.roomLoaded = true;
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
      } else {
        this.cancelledVoiceJoins.add(participant.id);
        if (!(await this.leaveVoiceSeat(participant.id))) this.sendVoiceError(socket, 'VOICE_UNAVAILABLE');
        room.participants = room.participants.filter((candidate) => candidate.id !== participant.id);
        if (room.teamSwapRequest && (room.teamSwapRequest.requesterId === participant.id || room.teamSwapRequest.targetId === participant.id)) {
          room.teamSwapRequest = null;
        }
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
      if (room.teamSwapRequest && room.teamSwapRequest.expiresAt > Date.now()) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'TEAM_SWAP_PENDING', message: 'Wait for the team change request to be answered or expire.' } });
      if (room.participants.some((player) => !player.isReady)) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'PLAYERS_NOT_READY', message: 'Wait for every friend to be ready.' } });
      room.gameState = createRoomGame(room);
      room.isMatchInProgress = true;
      room.rematchRequests = [];
      room.teamSwapRequest = null;
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
      room.teamSwapRequest = null;
      room.participants = room.participants.map((player) => ({ ...player, isReady: false }));
      await this.ctx.storage.deleteAlarm();
      await this.saveRoom();
      this.broadcastRoom();
      return;
    }

    if (message.type === 'CLIENT_REQUEST_TEAM_SWAP') {
      const payload = message.payload as { targetParticipantId?: unknown } | undefined;
      const targetId = typeof payload?.targetParticipantId === 'string' ? payload.targetParticipantId : '';
      const target = room.participants.find((candidate) => candidate.id === targetId);
      if (room.mode !== 'team_2v2' || room.isMatchInProgress || room.gameState) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'TEAM_SWAP_UNAVAILABLE', message: 'Teams can only be changed in the 2v2 room lobby before the match starts.' } });
      }
      if (room.teamSwapRequest && room.teamSwapRequest.expiresAt > Date.now()) return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'TEAM_SWAP_PENDING', message: 'A team change request is already waiting for a reply.' } });
      room.teamSwapRequest = null;
      const currentTeam = participant.teamId ?? COLOR_TEAMS[participant.color];
      const targetTeam = target?.teamId ?? (target ? COLOR_TEAMS[target.color] : undefined);
      if (!target || target.id === participant.id || !target.isConnected || target.isBot || currentTeam === targetTeam) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'INVALID_TEAM_SWAP_TARGET', message: 'Choose a connected human player on the other team.' } });
      }
      room.teamSwapRequest = {
        id: crypto.randomUUID(),
        requesterId: participant.id,
        targetId,
        expiresAt: Date.now() + TEAM_SWAP_REQUEST_TIMEOUT_MS,
      };
      await this.saveRoom();
      await this.ctx.storage.setAlarm(room.teamSwapRequest.expiresAt);
      this.broadcastRoom();
      return;
    }

    if (message.type === 'CLIENT_RESPOND_TEAM_SWAP') {
      const payload = message.payload as { requestId?: unknown; accept?: unknown } | undefined;
      const request = room.teamSwapRequest;
      if (!request || payload?.requestId !== request.id || request.targetId !== participant.id) {
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'TEAM_SWAP_REQUEST_EXPIRED', message: 'This team change request is no longer available.' } });
      }
      const requester = room.participants.find((candidate) => candidate.id === request.requesterId);
      const target = room.participants.find((candidate) => candidate.id === request.targetId);
      const requesterTeam = requester?.teamId ?? (requester ? COLOR_TEAMS[requester.color] : undefined);
      const targetTeam = target?.teamId ?? (target ? COLOR_TEAMS[target.color] : undefined);
      const canApply = room.mode === 'team_2v2' && !room.isMatchInProgress && !room.gameState &&
        request.expiresAt > Date.now() && requester?.isConnected && target?.isConnected &&
        requesterTeam !== undefined && targetTeam !== undefined && requesterTeam !== targetTeam;
      if (payload?.accept === true && !canApply) {
        room.teamSwapRequest = null;
        await this.saveRoom();
        await this.ctx.storage.deleteAlarm();
        this.broadcastRoom();
        return this.send(socket, { type: 'SERVER_ERROR', payload: { code: 'TEAM_SWAP_REQUEST_EXPIRED', message: 'This team change request is no longer available.' } });
      }
      if (payload?.accept === true && requester && target && requesterTeam && targetTeam) {
        requester.teamId = targetTeam;
        target.teamId = requesterTeam;
      }
      room.teamSwapRequest = null;
      await this.saveRoom();
      await this.ctx.storage.deleteAlarm();
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
      const moved = state.legalMoves.find((candidate) => candidate.tokenIndex === payload!.tokenIndex && candidate.tokenColor === (payload!.tokenColor ?? state.currentTurnColor));
      this.broadcastGame(moved ? {
        id: crypto.randomUUID(),
        color: moved.tokenColor ?? state.currentTurnColor,
        tokenIndex: moved.tokenIndex,
        fromStep: moved.fromStep,
        toStep: moved.toStep,
        capturedTokens: moved.willCaptureTokens.map((token) => ({ color: token.color, tokenIndex: token.index, fromStep: token.stepCount })),
      } : undefined);
      await this.scheduleBotIfNeeded();
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
      this.cancelledVoiceJoins.add(participant.id);
      await this.leaveVoiceSeat(participant.id);
      participant.isConnected = false;
      if (room?.teamSwapRequest && (room.teamSwapRequest.requesterId === participant.id || room.teamSwapRequest.targetId === participant.id)) {
        room.teamSwapRequest = null;
      }
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
    if (!room) return;
    const now = Date.now();
    await this.checkpointVoiceSessions(now);
    if (room.teamSwapRequest && (room.teamSwapRequest.expiresAt ?? 0) <= Date.now()) {
      room.teamSwapRequest = null;
      await this.saveRoom();
      this.broadcastRoom();
    }
    const state = room?.gameState;
    if (!state || state.phase === 'game_over') {
      await this.scheduleRoomAlarm();
      return;
    }
    // Older persisted rooms may not have a deadline yet. Start their timer
    // instead of treating a missing deadline as an expired human turn.
    if (room.turnDeadline === null || room.turnDeadline === undefined) {
      await this.scheduleBotIfNeeded();
      return;
    }
    if (room.turnDeadline > Date.now()) {
      await this.scheduleRoomAlarm();
      return;
    }
    const player = state.players.find((candidate) => candidate.color === state.currentTurnColor);
    let tokenMove: OnlineTokenMove | undefined;

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
      const move = chooseBotMove(state.legalMoves, player, state.players, state.rules, state.isTeamMode, createSeededRandom(`${state.seed}:${state.rngState}:${state.nextEventId}:${player.color}`));
      if (move) {
        const applied = applyMove(state, { actorColor: player.color, tokenIndex: move.tokenIndex, tokenColor: move.tokenColor });
        if (applied.ok) {
          room.gameState = applied.state;
          tokenMove = {
            id: crypto.randomUUID(),
            color: move.tokenColor ?? player.color,
            tokenIndex: move.tokenIndex,
            fromStep: move.fromStep,
            toStep: move.toStep,
            capturedTokens: move.willCaptureTokens.map((token) => ({ color: token.color, tokenIndex: token.index, fromStep: token.stepCount })),
          };
        }
      }
    }
    await this.saveRoom();
    await this.scheduleBotIfNeeded();
    this.broadcastGame(tokenMove);
  }

  private async scheduleBotIfNeeded(resetDeadline = true): Promise<void> {
    const room = this.room;
    const state = room?.gameState;
    if (!room || !state || state.phase === 'game_over') {
      if (room) room.turnDeadline = null;
      await this.scheduleRoomAlarm();
      return;
    }
    let delayMs = TURN_TIMEOUT_MS;
    if (state.phase === 'moving' && state.legalMoves.length === 0) delayMs = 900;
    else if (state.players.find((candidate) => candidate.color === state.currentTurnColor)?.isBot) {
      delayMs = getBotThinkingDelayMs(`${state.seed}:${state.rngState}:${state.nextEventId}:thinking`);
    }
    if (resetDeadline || room.turnDeadline === null || room.turnDeadline === undefined) {
      room.turnDeadline = Date.now() + delayMs;
      await this.saveRoom();
    }
    await this.scheduleRoomAlarm();
  }
}

import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { beforeEach, vi } from 'vitest';
import { createInitialGameState, rollDice } from '../../engine/gameEngine';
import worker, { LudoRoom } from '../../../worker/index';

class MemoryStorage {
  values = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.values.get(key)) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, structuredClone(value)); }
  async deleteAll(): Promise<void> { this.values.clear(); }
  async setAlarm(time: number): Promise<void> { this.alarmAt = time; }
  async deleteAlarm(): Promise<void> { this.alarmAt = null; }
}

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  attachment: unknown;
  closedWith: number | null = null;
  send(message: string) { this.sent.push(message); }
  close(code = 1000) { this.closedWith = code; this.readyState = 3; }
  serializeAttachment(value: unknown) { this.attachment = value; }
  deserializeAttachment() { return this.attachment; }
}

class MemoryRoomState {
  storage = new MemoryStorage();
  sockets: FakeSocket[] = [];
  acceptWebSocket(socket: FakeSocket) { this.sockets.push(socket); }
  getWebSockets() { return this.sockets; }
}

class MemoryNamespace {
  rooms = new Map<string, { state: MemoryRoomState; room: LudoRoom }>();
  idFromName(name: string) { return name; }
  get(id: string) {
    let entry = this.rooms.get(id);
    if (!entry) {
      const state = new MemoryRoomState();
      entry = { state, room: new LudoRoom(state as never, { LUDO_ROOMS: this as never }) };
      this.rooms.set(id, entry);
    }
    return { fetch: (request: Request) => entry!.room.fetch(request) };
  }
}

const rules = {
  sixToExit: true,
  extraTurnOnSix: true,
  extraTurnOnCapture: true,
  extraTurnOnFinish: true,
  consecutiveSixForfeit: true,
  safeStarsActive: true,
};

describe('online private rooms', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));

  it('rejects untrusted browser origins and allows the app origin', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const body = JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules });
    const rejected = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body,
    }), env);
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const accepted = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://game.test' },
      body,
    }), env);
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get('Access-Control-Allow-Origin')).toBe('https://game.test');
  });

  it('requires reconnect-token authentication before accepting room actions', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const response = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await response.json() as { roomCode: string; token: string; participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const unauthenticated = new FakeSocket();
    unauthenticated.serializeAttachment({ participantId: null });
    entry.state.acceptWebSocket(unauthenticated);

    await entry.room.webSocketMessage(unauthenticated as never, JSON.stringify({ type: 'CLIENT_START_MATCH' }));
    expect(unauthenticated.closedWith).toBe(4003);
    expect(JSON.parse(unauthenticated.sent[0])).toMatchObject({
      type: 'SERVER_ERROR', payload: { code: 'AUTH_REQUIRED' },
    });

    const authenticated = new FakeSocket();
    authenticated.serializeAttachment({ participantId: null });
    entry.state.acceptWebSocket(authenticated);
    await entry.room.webSocketMessage(authenticated as never, JSON.stringify({
      type: 'CLIENT_AUTH', payload: { token: host.token },
    }));
    expect(authenticated.deserializeAttachment()).toEqual({ participantId: host.participantId });
    expect(authenticated.sent.map((message) => JSON.parse(message).type)).toContain('SERVER_AUTHENTICATED');
  });

  it('rate limits room creation and joins before they reach Durable Objects', async () => {
    const namespace = new MemoryNamespace();
    const deniedLimiter = { limit: async () => ({ success: false }) };
    const createLimited = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), { LUDO_ROOMS: namespace as never, CREATE_ROOM_LIMITER: deniedLimiter });
    expect(createLimited.status).toBe(429);
    expect(namespace.rooms.size).toBe(0);

    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), { LUDO_ROOMS: namespace as never });
    const host = await created.json() as { roomCode: string };
    const joinLimited = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), { LUDO_ROOMS: namespace as never, JOIN_ROOM_LIMITER: deniedLimiter });
    expect(joinLimited.status).toBe(429);
    expect((namespace.rooms.get(host.roomCode)!.state.storage.values.get('room') as { participants: unknown[] }).participants).toHaveLength(1);
  });

  it('creates a shareable room and lets another player join with its code', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const create = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    expect(create.status, JSON.stringify(await create.clone().json())).toBe(201);
    const host = await create.json() as { roomCode: string; token: string; participantId: string; room: { participants: unknown[] } };
    expect(host.roomCode).toMatch(/^LUDO-[A-HJ-NP-Z2-9]{6}$/);

    const join = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), env);
    expect(join.status).toBe(201);
    const friend = await join.json() as { participantId: string; room: { participants: Array<{ name: string; color: string }> } };
    expect(friend.room.participants).toHaveLength(2);
    expect(friend.room.participants[1]).toMatchObject({ name: 'Friend', color: 'green' });
  });

  it('sanitizes chat, stamps the authenticated sender, broadcasts to room members, and restores history', async () => {
    const namespace = new MemoryNamespace();
    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), { LUDO_ROOMS: namespace as never });
    const host = await created.json() as { roomCode: string; participantId: string; token: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const hostSocket = new FakeSocket();
    const unauthenticatedSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    unauthenticatedSocket.serializeAttachment({ participantId: null });
    entry.state.acceptWebSocket(hostSocket);
    entry.state.acceptWebSocket(unauthenticatedSocket);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({
      type: 'chat',
      text: '  Hello\u200B   <img src=x onerror=alert(1)>  ',
      name: 'Spoofed name',
      color: 'blue',
      id: 'spoofed-id',
    }));

    const broadcast = hostSocket.sent.map((item) => JSON.parse(item)).find((item) => item.type === 'chat');
    expect(broadcast.message).toMatchObject({
      color: 'red',
      name: 'Host',
      text: 'Hello <img src=x onerror=alert(1)>',
    });
    expect(broadcast.message.id).not.toBe('spoofed-id');
    expect(unauthenticatedSocket.sent.map((item) => JSON.parse(item)).some((item) => item.type === 'chat')).toBe(false);
    expect(entry.state.storage.values.get('room')).not.toHaveProperty('chatMessages');

    const reconnectSocket = new FakeSocket();
    reconnectSocket.serializeAttachment({ participantId: null });
    entry.state.acceptWebSocket(reconnectSocket);
    await entry.room.webSocketMessage(reconnectSocket as never, JSON.stringify({
      type: 'CLIENT_AUTH', payload: { token: host.token },
    }));
    expect(reconnectSocket.sent.map((item) => JSON.parse(item)).find((item) => item.type === 'chat_history'))
      .toMatchObject({ messages: [broadcast.message] });
  });

  it('rejects invalid and oversized chat, rate limits 5 messages per connection, then recovers', async () => {
    const namespace = new MemoryNamespace();
    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), { LUDO_ROOMS: namespace as never });
    const host = await created.json() as { roomCode: string; participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = new FakeSocket();
    socket.serializeAttachment({ participantId: host.participantId });
    entry.state.acceptWebSocket(socket);

    const initialTime = Date.now();
    let now = initialTime;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const send = async (message: unknown) => entry.room.webSocketMessage(socket as never, JSON.stringify(message));
    try {
      await entry.room.webSocketMessage(socket as never, 'null');
      for (const text of ['', '   ', null, 'ব'.repeat(201), '😀'.repeat(201)]) {
        await send({ type: 'chat', text });
      }
      await send({ type: 'chat', text: 'x'.repeat(5000) });
      await send({ type: 'chat_reaction', reaction: 'not-a-reaction' });
      expect(socket.sent.map((item) => JSON.parse(item)).filter((item) => item.type === 'chat')).toHaveLength(0);
      expect(socket.sent.map((item) => JSON.parse(item)).filter((item) => item.type === 'error' && item.code === 'CHAT_INVALID')).toHaveLength(7);
      expect(socket.sent.map((item) => JSON.parse(item)).find((item) => item.type === 'SERVER_ERROR'))
        .toMatchObject({ payload: { code: 'INVALID_MESSAGE' } });

      for (let index = 0; index < 5; index += 1) {
        await send({ type: 'chat', text: `message ${index}` });
        now += 100;
      }
      await send({ type: 'chat', text: 'blocked' });
      expect(socket.sent.map((item) => JSON.parse(item)).at(-1)).toMatchObject({
        type: 'error', code: 'CHAT_RATE_LIMITED',
      });

      now += 10_000;
      await send({ type: 'chat', text: 'recovered' });
      expect(socket.sent.map((item) => JSON.parse(item)).at(-1)).toMatchObject({
        type: 'chat', message: { text: 'recovered' },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('caps chat history at 50 messages and lets only the host toggle chat', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await created.json() as { roomCode: string; participantId: string; token: string };
    const joined = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), env);
    const friend = await joined.json() as { participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const hostSocket = new FakeSocket();
    const friendSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    friendSocket.serializeAttachment({ participantId: friend.participantId });
    entry.state.acceptWebSocket(hostSocket);
    entry.state.acceptWebSocket(friendSocket);

    const initialTime = Date.now();
    let now = initialTime;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      for (let index = 0; index < 55; index += 1) {
        if (index > 0 && index % 5 === 0) now += 10_000;
        await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'chat', text: `message ${index}` }));
        now += 100;
      }
      await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({
        type: 'CLIENT_SET_CHAT_ENABLED', payload: { enabled: false },
      }));
      expect(friendSocket.sent.map((item) => JSON.parse(item)).at(-1)).toMatchObject({
        type: 'SERVER_ERROR', payload: { code: 'NOT_HOST' },
      });

      const reconnectSocket = new FakeSocket();
      reconnectSocket.serializeAttachment({ participantId: null });
      entry.state.acceptWebSocket(reconnectSocket);
      await entry.room.webSocketMessage(reconnectSocket as never, JSON.stringify({
        type: 'CLIENT_AUTH', payload: { token: host.token },
      }));
      const history = reconnectSocket.sent.map((item) => JSON.parse(item)).find((item) => item.type === 'chat_history');
      expect(history.messages).toHaveLength(50);
      expect(history.messages[0].text).toBe('message 5');
      expect(history.messages[49].text).toBe('message 54');

      await entry.room.webSocketMessage(reconnectSocket as never, JSON.stringify({
        type: 'CLIENT_SET_CHAT_ENABLED', payload: { enabled: false },
      }));
      await entry.room.webSocketMessage(reconnectSocket as never, JSON.stringify({ type: 'chat', text: 'disabled' }));
      expect(reconnectSocket.sent.map((item) => JSON.parse(item)).at(-1)).toMatchObject({
        type: 'error', code: 'CHAT_DISABLED',
      });
      expect((entry.state.storage.values.get('room') as { chatEnabled?: boolean }).chatEnabled).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps simultaneous joins consistent when a Durable Object cold-loads a room', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await created.json() as { roomCode: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const originalGet = entry.state.storage.get.bind(entry.state.storage);
    entry.state.storage.get = async <T>(key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return originalGet<T>(key);
    };

    const join = (playerName: string) => worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName }),
    }), env);
    const [firstResponse, secondResponse] = await Promise.all([join('Friend One'), join('Friend Two')]);
    const [first, second] = await Promise.all([
      firstResponse.json() as Promise<{ participantId: string; room: { participants: Array<{ id: string; name: string; color: string }> } }>,
      secondResponse.json() as Promise<{ participantId: string; room: { participants: Array<{ id: string; name: string; color: string }> } }>,
    ]);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    const stored = entry.state.storage.values.get('room') as { participants: Array<{ id: string; name: string; color: string }> };
    expect(stored.participants.map(({ name }) => name)).toEqual(['Host', 'Friend One', 'Friend Two']);
    expect(new Set(stored.participants.map(({ color }) => color)).size).toBe(3);
    expect(stored.participants.some(({ id }) => id === first.participantId)).toBe(true);
    expect(stored.participants.some(({ id }) => id === second.participantId)).toBe(true);
  });

  it('skips a disconnected player after their authoritative turn deadline', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const createdResponse = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await createdResponse.json() as { roomCode: string; participantId: string };
    const joinedResponse = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), env);
    const entry = namespace.rooms.get(host.roomCode)!;
    const stored = entry.state.storage.values.get('room') as {
      isMatchInProgress: boolean;
      participants: Array<{ id: string; isConnected: boolean }>;
      gameState: ReturnType<typeof createInitialGameState> | null;
      turnDeadline: number | null;
    };
    stored.isMatchInProgress = true;
    stored.participants.find((participant) => participant.id === host.participantId)!.isConnected = false;
    stored.gameState = createInitialGameState('classic_4p', 'red', undefined, rules);
    stored.turnDeadline = Date.now() - 1;
    entry.state.storage.values.set('room', stored);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const socket = new FakeSocket();
    socket.serializeAttachment({ participantId: host.participantId });
    entry.state.acceptWebSocket(socket);

    await entry.room.alarm();

    const updated = entry.state.storage.values.get('room') as { gameState: ReturnType<typeof createInitialGameState>; turnDeadline: number };
    expect(updated.gameState.currentTurnColor).toBe('green');
    expect(updated.gameState.lastAction).toMatchObject({ type: 'pass', color: 'red' });
    expect(updated.turnDeadline).toBeGreaterThan(Date.now());
    expect(socket.sent.map((item) => JSON.parse(item)).at(-1)).toMatchObject({
      type: 'SERVER_TURN_TIMEOUT',
      payload: { timedOutColor: 'red' },
    });
  });

  it('accepts a legal online token move and broadcasts the updated board state', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const createdResponse = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await createdResponse.json() as { roomCode: string; participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const stored = entry.state.storage.values.get('room') as {
      isMatchInProgress: boolean;
      gameState: ReturnType<typeof createInitialGameState> | null;
      turnDeadline: number | null;
    };
    stored.isMatchInProgress = true;
    const rolled = rollDice(createInitialGameState('classic_4p', 'red', undefined, rules), 6);
    if (!rolled.ok) throw new Error(rolled.error);
    stored.gameState = rolled.state;
    stored.turnDeadline = Date.now() + 30_000;
    entry.state.storage.values.set('room', stored);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const hostSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    entry.state.acceptWebSocket(hostSocket);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({
      type: 'CLIENT_SELECT_MOVE',
      payload: { tokenIndex: stored.gameState!.legalMoves[0].tokenIndex, tokenColor: 'red' },
    }));

    const sync = hostSocket.sent.map((item) => JSON.parse(item)).reverse().find((message) => message.type === 'SERVER_GAME_STATE_SYNC');
    expect(sync.payload.state.players.find((player: { color: string }) => player.color === 'red').tokens[0].stepCount).toBe(0);
    expect(sync.payload.move).toMatchObject({ color: 'red', tokenIndex: 0, fromStep: -1, toStep: 0 });
    expect(sync.payload.state.phase).toBe('rolling');
    expect(sync.payload.state.currentTurnColor).toBe('red');
  });

  it('broadcasts captured pawn positions with an online capture move', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const createdResponse = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await createdResponse.json() as { roomCode: string; participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const stored = entry.state.storage.values.get('room') as {
      isMatchInProgress: boolean;
      gameState: ReturnType<typeof createInitialGameState> | null;
      turnDeadline: number | null;
    };
    const game = createInitialGameState('classic_4p', 'red', undefined, rules);
    const players = game.players.map((player) => {
      if (player.color === 'red') {
        return { ...player, tokens: player.tokens.map((token, index) => index === 0 ? { ...token, stepCount: 4, isInYard: false } : token) };
      }
      if (player.color === 'green') {
        return { ...player, tokens: player.tokens.map((token, index) => index === 0 ? { ...token, stepCount: 44, isInYard: false } : token) };
      }
      return player;
    });
    const rolled = rollDice({ ...game, players }, 1);
    if (!rolled.ok) throw new Error(rolled.error);
    expect(rolled.state.legalMoves[0].willCaptureTokens).toHaveLength(1);
    stored.isMatchInProgress = true;
    stored.gameState = rolled.state;
    stored.turnDeadline = Date.now() + 30_000;
    entry.state.storage.values.set('room', stored);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const hostSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    entry.state.acceptWebSocket(hostSocket);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({
      type: 'CLIENT_SELECT_MOVE', payload: { tokenIndex: 0, tokenColor: 'red' },
    }));

    const sync = hostSocket.sent.map((item) => JSON.parse(item)).reverse().find((message) => message.type === 'SERVER_GAME_STATE_SYNC');
    expect(sync.payload.move.capturedTokens).toEqual([{ color: 'green', tokenIndex: 0, fromStep: 44 }]);
    expect(sync.payload.state.players.find((player: { color: string }) => player.color === 'green').tokens[0].stepCount).toBe(-1);
  });

  it('broadcasts movement metadata for bot moves to every connected client', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'team_2v2', playerName: 'Host', rules }),
    }), env);
    const host = await created.json() as { roomCode: string; participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const stored = entry.state.storage.values.get('room') as {
      isMatchInProgress: boolean;
      gameState: ReturnType<typeof createInitialGameState> | null;
      turnDeadline: number | null;
    };
    const game = createInitialGameState({ id: 'bot-move-test', seed: 'bot-move-test', mode: 'team_2v2', customRules: rules });
    const green = game.players.find((player) => player.color === 'green')!;
    green.tokens[0] = { ...green.tokens[0], stepCount: 0, isInYard: false };
    game.currentTurnColor = 'green';
    const rolled = rollDice(game, 1);
    if (!rolled.ok) throw new Error(rolled.error);
    stored.isMatchInProgress = true;
    stored.gameState = rolled.state;
    stored.turnDeadline = Date.now() - 1;
    entry.state.storage.values.set('room', stored);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const hostSocket = new FakeSocket();
    const observerSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    observerSocket.serializeAttachment({ participantId: 'observer' });
    entry.state.acceptWebSocket(hostSocket);
    entry.state.acceptWebSocket(observerSocket);

    await entry.room.alarm();

    for (const socket of [hostSocket, observerSocket]) {
      const sync = socket.sent.map((item) => JSON.parse(item)).find((message) => message.type === 'SERVER_GAME_STATE_SYNC');
      expect(sync?.payload.move).toMatchObject({ color: 'green', tokenIndex: 0, fromStep: 0, toStep: 1 });
    }
  });

  it('requires the invited opposite-team player to accept a lobby team switch and supports decline', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const created = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'team_2v2', playerName: 'Host', rules }),
    }), env);
    const host = await created.json() as { roomCode: string; participantId: string };
    const joined = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), env);
    const friend = await joined.json() as { participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const stored = entry.state.storage.values.get('room') as {
      mode: 'team_2v2'; isMatchInProgress: boolean;
      participants: Array<{ id: string; color: 'red' | 'green' | 'yellow' | 'blue'; isConnected: boolean; isReady: boolean; teamId?: string }>;
      gameState: ReturnType<typeof createInitialGameState> | null;
    };
    stored.isMatchInProgress = false;
    stored.gameState = null;
    stored.participants = stored.participants.map((player) => ({ ...player, isConnected: true, isReady: true }));
    stored.participants.forEach((participant) => { participant.teamId = participant.color === 'red' || participant.color === 'yellow' ? 'team_A' : 'team_B'; });
    entry.state.storage.values.set('room', stored);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const hostSocket = new FakeSocket();
    const friendSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    friendSocket.serializeAttachment({ participantId: friend.participantId });
    entry.state.acceptWebSocket(hostSocket);
    entry.state.acceptWebSocket(friendSocket);

    const request = () => entry.room.webSocketMessage(hostSocket as never, JSON.stringify({
      type: 'CLIENT_REQUEST_TEAM_SWAP', payload: { targetParticipantId: friend.participantId },
    }));
    await request();
    let waiting = entry.state.storage.values.get('room') as typeof stored & { teamSwapRequest: { id: string; requesterId: string; targetId: string; expiresAt: number } };
    expect(waiting.teamSwapRequest).toMatchObject({ requesterId: host.participantId, targetId: friend.participantId });
    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_START_MATCH' }));
    expect(hostSocket.sent.map((item) => JSON.parse(item)).at(-1)).toMatchObject({
      type: 'SERVER_ERROR', payload: { code: 'TEAM_SWAP_PENDING' },
    });
    await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({
      type: 'CLIENT_RESPOND_TEAM_SWAP', payload: { requestId: waiting.teamSwapRequest.id, accept: false },
    }));
    waiting = entry.state.storage.values.get('room') as typeof waiting;
    expect(waiting.teamSwapRequest).toBeNull();
    expect(waiting.participants.find((player) => player.id === host.participantId)?.teamId).toBe('team_A');

    await request();
    waiting = entry.state.storage.values.get('room') as typeof waiting;
    waiting.teamSwapRequest.expiresAt = Date.now() - 1;
    entry.state.storage.values.set('room', waiting);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    await entry.room.alarm();
    expect((entry.state.storage.values.get('room') as typeof waiting).teamSwapRequest).toBeNull();

    await request();
    waiting = entry.state.storage.values.get('room') as typeof waiting;
    const acceptedRequestId = waiting.teamSwapRequest.id;
    await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({
      type: 'CLIENT_RESPOND_TEAM_SWAP', payload: { requestId: acceptedRequestId, accept: true },
    }));
    const updated = entry.state.storage.values.get('room') as typeof waiting;
    expect(updated.teamSwapRequest).toBeNull();
    expect(updated.participants.find((player) => player.id === host.participantId)?.teamId).toBe('team_B');
    expect(updated.participants.find((player) => player.id === friend.participantId)?.teamId).toBe('team_A');
    for (const socket of [hostSocket, friendSocket]) {
      const messages = socket.sent.map((item) => JSON.parse(item));
      expect(messages.some((message) => message.type === 'SERVER_ROOM_STATE' && message.payload.teamSwapRequest === null)).toBe(true);
      expect(messages.some((message) => message.type === 'SERVER_GAME_STATE_SYNC')).toBe(false);
    }

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_START_MATCH' }));
    const started = entry.state.storage.values.get('room') as typeof waiting;
    expect(started.gameState?.players.find((player) => player.color === 'red')?.teamId).toBe('team_B');
    expect(started.gameState?.players.find((player) => player.color === 'green')?.teamId).toBe('team_A');
  });

  it('keeps dice rolls authoritative and starts only after every joined friend is ready', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const createdResponse = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await createdResponse.json() as { roomCode: string; participantId: string; token: string };
    const joinedResponse = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), env);
    const friend = await joinedResponse.json() as { participantId: string; token: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const hostSocket = new FakeSocket();
    const friendSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    friendSocket.serializeAttachment({ participantId: friend.participantId });
    entry.state.acceptWebSocket(hostSocket);
    entry.state.acceptWebSocket(friendSocket);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_START_MATCH' }));
    expect(JSON.parse(hostSocket.sent.at(-1)!).payload.message).toContain('ready');

    await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({ type: 'CLIENT_SET_READY', payload: { isReady: true } }));
    await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({ type: 'CLIENT_ROLL_DICE' }));
    expect(JSON.parse(friendSocket.sent.at(-1)!).payload.code).toBe('NOT_YOUR_TURN');

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_START_MATCH' }));
    const started = hostSocket.sent.map((item) => JSON.parse(item)).reverse().find((message) => message.type === 'SERVER_GAME_STATE_SYNC');
    expect(started.payload.state.players.find((player: { color: string }) => player.color === 'green').name).toBe('Friend');
    expect(started.payload.state.players.find((player: { color: string }) => player.color === 'yellow').isBot).toBe(true);

    const activeGame = structuredClone((entry.state.storage.values.get('room') as {
      gameState: ReturnType<typeof createInitialGameState>;
    }).gameState);
    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_START_MATCH' }));
    const duplicateStartError = hostSocket.sent.map((item) => JSON.parse(item)).at(-1);
    const gameAfterDuplicateStart = (entry.state.storage.values.get('room') as {
      gameState: ReturnType<typeof createInitialGameState>;
    }).gameState;
    expect(duplicateStartError).toMatchObject({
      type: 'SERVER_ERROR',
      payload: { code: 'MATCH_ALREADY_STARTED' },
    });
    expect(gameAfterDuplicateStart).toEqual(activeGame);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_ROLL_DICE' }));
    const rolled = hostSocket.sent.map((item) => JSON.parse(item)).reverse().find((message) => message.type === 'SERVER_GAME_STATE_SYNC');
    expect(['roll', 'pass']).toContain(rolled.payload.state.lastAction.type);
    expect(rolled.payload.state.lastAction.dice).toBeGreaterThanOrEqual(1);
    expect(rolled.payload.state.lastAction.dice).toBeLessThanOrEqual(6);

    const reconnect = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Host', token: host.token }),
    }), env);
    expect(reconnect.status).toBe(200);
    expect((await reconnect.json() as { participantId: string }).participantId).toBe(host.participantId);

    const tooLate = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Late Player' }),
    }), env);
    expect(tooLate.status).toBe(409);
    expect(rolled.payload.state.diceValue).toBeGreaterThanOrEqual(1);
    expect(rolled.payload.state.diceValue).toBeLessThanOrEqual(6);
  });

  it('starts a rematch after connected humans request it and lets the host return to the room lobby', async () => {
    const namespace = new MemoryNamespace();
    const env = { LUDO_ROOMS: namespace as never };
    const createdResponse = await worker.fetch(new Request('https://game.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules }),
    }), env);
    const host = await createdResponse.json() as { roomCode: string; participantId: string };
    const joinedResponse = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Friend' }),
    }), env);
    const friend = await joinedResponse.json() as { participantId: string };
    const thirdJoinResponse = await worker.fetch(new Request(`https://game.test/api/rooms/${host.roomCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Disconnected Friend' }),
    }), env);
    const thirdFriend = await thirdJoinResponse.json() as { participantId: string };
    const entry = namespace.rooms.get(host.roomCode)!;
    const stored = entry.state.storage.values.get('room') as {
      isMatchInProgress: boolean;
      participants: Array<{ id: string; isConnected: boolean; isReady: boolean }>;
      gameState: ReturnType<typeof createInitialGameState> | null;
      rematchRequests: string[];
    };
    stored.isMatchInProgress = true;
    stored.participants = stored.participants.map((participant) => ({
      ...participant,
      isConnected: participant.id !== thirdFriend.participantId,
      isReady: true,
    }));
    stored.gameState = createInitialGameState({
      id: 'finished-room-game',
      seed: 'finished-room-seed',
      mode: 'classic_4p',
      customRules: rules,
    });
    stored.gameState.phase = 'game_over';
    stored.gameState.winnerColor = 'red';
    stored.rematchRequests = [];
    entry.state.storage.values.set('room', stored);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    const hostSocket = new FakeSocket();
    const friendSocket = new FakeSocket();
    hostSocket.serializeAttachment({ participantId: host.participantId });
    friendSocket.serializeAttachment({ participantId: friend.participantId });
    entry.state.acceptWebSocket(hostSocket);
    entry.state.acceptWebSocket(friendSocket);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_REQUEST_REMATCH' }));
    const waitingRoom = entry.state.storage.values.get('room') as typeof stored;
    expect(waitingRoom.rematchRequests).toEqual([host.participantId]);
    expect(waitingRoom.gameState?.id).toBe('finished-room-game');

    await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({ type: 'CLIENT_REQUEST_REMATCH' }));
    const rematched = entry.state.storage.values.get('room') as typeof stored;
    expect(rematched.gameState?.id).not.toBe('finished-room-game');
    expect(rematched.gameState?.seed).not.toBe('finished-room-seed');
    expect(rematched.gameState?.rules).toEqual(stored.gameState.rules);
    expect(rematched.gameState?.players.find((player) => player.color === 'red')).toMatchObject({
      id: host.participantId,
      name: 'Host',
      isBot: false,
    });
    expect(rematched.gameState?.players.find((player) => player.color === 'green')).toMatchObject({
      id: friend.participantId,
      name: 'Friend',
      isBot: false,
    });
    expect(rematched.gameState?.players.find((player) => player.color === 'yellow')).toMatchObject({
      id: thirdFriend.participantId,
      name: 'Disconnected Friend',
      isBot: false,
    });
    expect(rematched.participants.every((participant) => !participant.isReady)).toBe(true);
    expect(rematched.rematchRequests).toEqual([]);

    rematched.gameState!.phase = 'game_over';
    entry.state.storage.values.set('room', rematched);
    entry.room = new LudoRoom(entry.state as never, { LUDO_ROOMS: namespace as never });
    await entry.room.webSocketMessage(friendSocket as never, JSON.stringify({ type: 'CLIENT_BACK_TO_LOBBY' }));
    expect(JSON.parse(friendSocket.sent.at(-1)!).payload.code).toBe('NOT_HOST');
    expect((entry.state.storage.values.get('room') as typeof stored).isMatchInProgress).toBe(true);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'CLIENT_BACK_TO_LOBBY' }));
    const lobby = entry.state.storage.values.get('room') as typeof stored;
    expect(lobby.isMatchInProgress).toBe(false);
    expect(lobby.gameState).toBeNull();
    expect(lobby.participants.map((participant) => participant.id)).toEqual([
      host.participantId,
      friend.participantId,
      thirdFriend.participantId,
    ]);
    expect(lobby.rematchRequests).toEqual([]);
  });
});

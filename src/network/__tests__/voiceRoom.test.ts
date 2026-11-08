import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { LudoRoom, VoiceBudget } from '../../../worker/index';

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
  send(message: string) { this.sent.push(message); }
  close() { this.readyState = 3; }
  serializeAttachment(value: unknown) { this.attachment = value; }
  deserializeAttachment() { return this.attachment; }
}

class MemoryRoomState {
  storage = new MemoryStorage();
  sockets: FakeSocket[] = [];
  acceptWebSocket(socket: FakeSocket) { this.sockets.push(socket); }
  getWebSockets() { return this.sockets; }
}

class MemoryBudgetState {
  storage = new MemoryStorage();
}

class MemoryBudgetNamespace {
  private readonly state = new MemoryBudgetState();
  private readonly budget = new VoiceBudget(this.state);
  idFromName(name: string) { return name; }
  get(_id: string) { return { fetch: (request: Request) => this.budget.fetch(request) }; }
}

const secrets = {
  CF_ACCOUNT_ID: 'account-id',
  REALTIMEKIT_APP_ID: 'app-id',
  REALTIMEKIT_API_TOKEN: 'never-return-this-api-token',
  REALTIMEKIT_VOICE_PRESET: 'voice-only',
  VOICE_BUDGET_ADMIN_SECRET: 'administrator-only-secret',
};

class MemoryRoomNamespace {
  readonly rooms = new Map<string, { state: MemoryRoomState; room: LudoRoom }>();
  readonly budget = new MemoryBudgetNamespace();
  readonly env = { LUDO_ROOMS: this, VOICE_BUDGET: this.budget, ...secrets };
  idFromName(name: string) { return name; }
  get(id: string) {
    let entry = this.rooms.get(id);
    if (!entry) {
      const state = new MemoryRoomState();
      entry = { state, room: new LudoRoom(state as never, this.env as never) };
      this.rooms.set(id, entry);
    }
    return { fetch: (request: Request) => entry!.room.fetch(request) };
  }
}

async function createHost(namespace: MemoryRoomNamespace) {
  const response = await worker.fetch(new Request('https://game.test/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'classic_4p', playerName: 'Host', rules: {} }),
  }), namespace.env as never);
  return await response.json() as { roomCode: string; participantId: string; token: string };
}

interface ApiCall { url: string; method: string; body?: Record<string, unknown>; }

function realtimeMock() {
  const calls: ApiCall[] = [];
  const ref = { failDeletes: false };
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (method === 'POST' && url.endsWith('/meetings')) {
      return Response.json({ success: true, data: { id: 'meeting-id' } });
    }
    if (method === 'POST' && url.endsWith('/participants')) {
      return Response.json({ success: true, data: { id: 'participant-id', token: 'private-client-token' } });
    }
    if (method === 'DELETE') {
      if (ref.failDeletes) return Response.json({ success: false }, { status: 500 });
      return new Response(null, { status: 204 });
    }
    return Response.json({ success: false }, { status: 404 });
  });
  return { mock, calls, ref };
}

async function authSocket(
  entry: { state: MemoryRoomState; room: LudoRoom },
  token: string,
): Promise<FakeSocket> {
  const socket = new FakeSocket();
  socket.serializeAttachment({ participantId: null });
  entry.state.acceptWebSocket(socket);
  await entry.room.webSocketMessage(socket as never, JSON.stringify({
    type: 'CLIENT_AUTH', payload: { token },
  }));
  return socket;
}

function sentMessages(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
}

function inMemoryRoom(entry: { room: LudoRoom }): Record<string, unknown> {
  const room = (entry.room as unknown as { room: Record<string, unknown> | null }).room;
  if (!room) throw new Error('Room is not loaded in memory.');
  return room;
}

describe('online room voice', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  it('creates a private RealtimeKit participant, tracks it in the budget, and removes it on leave', async () => {
    const namespace = new MemoryRoomNamespace();
    const apiFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/meetings')) {
        return Response.json({ success: true, data: { id: 'meeting-id' } });
      }
      if (init?.method === 'POST' && url.endsWith('/participants')) {
        return Response.json({ success: true, data: { id: 'participant-id', token: 'private-client-token' } });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', apiFetch);

    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = new FakeSocket();
    socket.serializeAttachment({ participantId: null });
    entry.state.acceptWebSocket(socket);
    await entry.room.webSocketMessage(socket as never, JSON.stringify({
      type: 'CLIENT_AUTH', payload: { token: host.token },
    }));

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    const voiceToken = socket.sent.map((message) => JSON.parse(message)).find((message) => message.type === 'voice_token');
    expect(voiceToken).toEqual({ type: 'voice_token', authToken: 'private-client-token' });
    expect(entry.state.storage.values.get('room')).toMatchObject({
      voiceMeetingId: 'meeting-id',
      voiceParticipants: [{ seatId: host.participantId, color: 'red', participantId: 'participant-id' }],
    });
    expect(JSON.stringify(entry.state.storage.values.get('room'))).not.toContain('private-client-token');
    expect(apiFetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer never-return-this-api-token',
    });

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_leave' }));
    expect(entry.state.storage.values.get('room')).toMatchObject({ voiceParticipants: [], voiceCheckpointAt: null });
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    const budget = await namespace.budget.get('global').fetch(new Request(
      'https://budget.test/snapshot?limitMinutes=8000'
    ));
    expect(await budget.json()).toMatchObject({ usedMinutes: 1, activeMinutes: 0 });
    expect(socket.sent.map((message) => JSON.parse(message)).some((message) =>
      JSON.stringify(message).includes(secrets.REALTIMEKIT_API_TOKEN)
    )).toBe(false);
  });

  it('keeps voice unavailable without all server credentials and a budget binding', async () => {
    const namespace = new MemoryRoomNamespace();
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    entry.room = new LudoRoom(entry.state as never, {
      LUDO_ROOMS: namespace as never,
      VOICE_ENABLED: 'true',
    } as never);
    const socket = new FakeSocket();
    socket.serializeAttachment({ participantId: host.participantId });
    entry.state.acceptWebSocket(socket);

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(socket.sent.map((message) => JSON.parse(message)).at(-1)).toMatchObject({
      type: 'error', code: 'VOICE_UNAVAILABLE',
    });
  });

  it('protects the global usage endpoint and never returns credentials', async () => {
    const namespace = new MemoryRoomNamespace();
    const endpoint = 'https://game.test/api/admin/voice-budget';
    const denied = await worker.fetch(new Request(endpoint), namespace.env as never);
    expect(denied.status).toBe(401);

    const allowed = await worker.fetch(new Request(endpoint, {
      headers: { Authorization: `Bearer ${secrets.VOICE_BUDGET_ADMIN_SECRET}` },
    }), namespace.env as never);
    const report = await allowed.text();
    expect(allowed.status).toBe(200);
    expect(JSON.parse(report)).toMatchObject({ limitMinutes: 8000, usedMinutes: 0, activeMinutes: 0 });
    expect(report).not.toContain(secrets.REALTIMEKIT_API_TOKEN);
    expect(report).not.toContain(secrets.VOICE_BUDGET_ADMIN_SECRET);
  });

  it('creates exactly one RealtimeKit meeting for two simultaneous joins and always sends the Voice preset', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);

    const message = JSON.stringify({ type: 'voice_join' });
    await Promise.allSettled([
      entry.room.webSocketMessage(socket as never, message),
      entry.room.webSocketMessage(socket as never, message),
    ]);

    const meetingCreates = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/meetings'));
    expect(meetingCreates).toHaveLength(1);
    expect(meetingCreates[0].url).toContain(encodeURIComponent(secrets.CF_ACCOUNT_ID));
    expect(meetingCreates[0].url).toContain(encodeURIComponent(secrets.REALTIMEKIT_APP_ID));

    const participantAdds = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/participants'));
    expect(participantAdds.length).toBeGreaterThanOrEqual(1);
    for (const add of participantAdds) {
      expect(add.body).toMatchObject({
        name: 'Host',
        custom_participant_id: host.participantId,
        preset_name: secrets.REALTIMEKIT_VOICE_PRESET,
      });
      expect(JSON.stringify(add.body)).not.toContain(secrets.REALTIMEKIT_API_TOKEN);
    }
    expect(sentMessages(socket).some((message) => message.type === 'voice_token')).toBe(true);
  });

  it('rejects a fifth distinct voice seat before contacting RealtimeKit', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);

    const room = inMemoryRoom(entry);
    room.voiceMeetingId = 'meeting-id';
    room.voiceParticipants = (['blue', 'green', 'yellow', 'purple'] as const).map((color, index) => ({
      seatId: `guest-${index}`, color, participantId: `provider-${index}`, joinedAt: Date.now(), leaving: false,
    }));

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: 'error', code: 'VOICE_ROOM_FULL' });
    expect(calls.filter((call) => !call.url.includes('voice-budget.internal'))).toHaveLength(0);
  });

  it('limits repeated voice joins to five per rolling minute per connection', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);

    const message = JSON.stringify({ type: 'voice_join' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await entry.room.webSocketMessage(socket as never, message);
    }
    await entry.room.webSocketMessage(socket as never, message);

    const errors = sentMessages(socket).filter((message) => message.type === 'error');
    expect(errors).toEqual([{
      type: 'error',
      code: 'VOICE_RATE_LIMITED',
      retryAfterSeconds: expect.any(Number),
    }]);
    // Only the first join reaches RealtimeKit; the rest reuse the cached seat token.
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/participants'))).toHaveLength(1);
  });

  it('blocks new joins when the monthly budget is at the limit and reports the usage', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);

    const currentMonth = new Date().toISOString().slice(0, 7);
    const budgetState = (namespace.budget as unknown as {
      state: { storage: { values: Map<string, unknown> } };
    }).state;
    budgetState.storage.values.set('budget', { month: currentMonth, usedMinutes: 8000, active: {} });

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: 'error', code: 'VOICE_BUDGET_REACHED' });

    // No RealtimeKit call may be made once the budget is exhausted.
    expect(calls.filter((call) => !call.url.includes('voice-budget.internal')).length).toBe(0);
    // The global admin counter already records the exhausted usage for this month.
    const adminResponse = await worker.fetch(new Request('https://game.test/api/admin/voice-budget', {
      headers: { Authorization: `Bearer ${secrets.VOICE_BUDGET_ADMIN_SECRET}` },
    }), namespace.env as never);
    expect(await adminResponse.json()).toMatchObject({ month: currentMonth, usedMinutes: 8000, activeMinutes: 0 });
  });

  it('lets only the host disable voice, removes everyone, and can be re-enabled', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const joinResponse = await entry.room.fetch(new Request('https://room.test/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Guest' }),
    }));
    expect(joinResponse.status).toBe(201);
    const guest = await joinResponse.json() as { participantId: string; token: string };

    const hostSocket = await authSocket(entry, host.token);
    await authSocket(entry, guest.token);
    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(hostSocket).some((message) => message.type === 'voice_token')).toBe(true);

    // Non-hosts cannot toggle voice.
    const guestRoom = namespace.rooms.get(host.roomCode)!;
    const guestSocket = guestRoom.state.sockets.at(-1)!;
    await entry.room.webSocketMessage(guestSocket as never, JSON.stringify({
      type: 'CLIENT_SET_VOICE_ENABLED', payload: { enabled: false },
    }));
    const guestErrors = sentMessages(guestSocket).filter((message) => message.type === 'SERVER_ERROR');

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({
      type: 'CLIENT_SET_VOICE_ENABLED', payload: { enabled: false },
    }));

    expect(guestErrors).toEqual([{
      type: 'SERVER_ERROR',
      payload: expect.objectContaining({ code: 'NOT_HOST' }),
    }]);
    expect(calls.filter((call) => call.method === 'DELETE').length).toBeGreaterThanOrEqual(1);
    const stored = entry.state.storage.values.get('room') as {
      voiceEnabled?: boolean;
      voiceParticipants?: unknown[];
      voiceCheckpointAt?: number | null;
    };
    expect(stored).toMatchObject({ voiceEnabled: false, voiceParticipants: [], voiceCheckpointAt: null });
    expect(sentMessages(hostSocket).some((message) =>
      message.type === 'voice_status' && Array.isArray(message.seatsInVoice) && message.seatsInVoice.length === 0,
    )).toBe(true);

    await entry.room.webSocketMessage(hostSocket as never, JSON.stringify({
      type: 'CLIENT_SET_VOICE_ENABLED', payload: { enabled: true },
    }));
    expect((entry.state.storage.values.get('room') as { voiceEnabled?: boolean }).voiceEnabled).toBe(true);
  });

  it('blocks joins in a voice-disabled room without touching RealtimeKit', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);

    inMemoryRoom(entry).voiceEnabled = false;

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: 'error', code: 'VOICE_DISABLED' });
    expect(calls.filter((call) => !call.url.includes('voice-budget.internal'))).toHaveLength(0);
  });

  it('keeps the seat flagged and bounded to one removal attempt when RealtimeKit removal fails', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls, ref } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);
    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).some((message) => message.type === 'voice_token')).toBe(true);

    ref.failDeletes = true;
    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_leave' }));
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: 'error', code: 'VOICE_UNAVAILABLE' });

    const stored = entry.state.storage.values.get('room') as {
      voiceParticipants?: Array<{ seatId: string; leaving?: boolean } | undefined>;
    };
    expect(stored.voiceParticipants).toHaveLength(1);
    expect(stored.voiceParticipants?.[0]).toMatchObject({ seatId: host.participantId, leaving: true });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('never lets a bot seat join voice', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);

    const room = inMemoryRoom(entry);
    const me = (room.participants as Array<{ id: string; isBot: boolean }>).find((participant) =>
      participant.id === host.participantId);
    if (!me) throw new Error('Host participant not found.');
    me.isBot = true;

    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: 'error', code: 'VOICE_NOT_ALLOWED' });
    expect(calls.filter((call) => !call.url.includes('voice-budget.internal'))).toHaveLength(0);
  });

  it('removes the voice participant when the socket closes abruptly', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);
    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).some((message) => message.type === 'voice_token')).toBe(true);

    await entry.room.webSocketClose(socket as never);

    expect(calls.filter((call) => call.method === 'DELETE').length).toBeGreaterThanOrEqual(1);
    const stored = entry.state.storage.values.get('room') as {
      voiceParticipants?: unknown[];
      voiceCheckpointAt?: number | null;
      participants?: Array<{ id: string; isConnected?: boolean }>;
    };
    expect(stored).toMatchObject({ voiceParticipants: [], voiceCheckpointAt: null });
    expect(stored.participants?.find((participant) => participant.id === host.participantId)?.isConnected).toBe(false);
  });

  it('disconnects a long voice session at the three-hour cap via the alarm checkpoint', async () => {
    const namespace = new MemoryRoomNamespace();
    const { mock, calls } = realtimeMock();
    vi.stubGlobal('fetch', mock);
    const host = await createHost(namespace);
    const entry = namespace.rooms.get(host.roomCode)!;
    const socket = await authSocket(entry, host.token);
    await entry.room.webSocketMessage(socket as never, JSON.stringify({ type: 'voice_join' }));
    expect(sentMessages(socket).some((message) => message.type === 'voice_token')).toBe(true);

    const room = inMemoryRoom(entry);
    (room.voiceParticipants as Array<{ joinedAt: number }>)[0].joinedAt = Date.now() - (3 * 60 * 60 * 1000 + 1);

    await entry.room.alarm();

    expect(calls.filter((call) => call.method === 'DELETE').length).toBeGreaterThanOrEqual(1);
    expect(sentMessages(socket).some((message) => message.type === 'voice_session_expired')).toBe(true);
    const stored = entry.state.storage.values.get('room') as { voiceParticipants?: unknown[] };
    expect(stored.voiceParticipants).toHaveLength(0);
  });
});

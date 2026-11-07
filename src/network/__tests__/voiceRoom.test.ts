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
});

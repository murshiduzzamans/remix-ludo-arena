import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceBudget } from '../../../worker/voiceBudget';

class MemoryBudgetStorage {
  value: unknown;

  async get<T>(): Promise<T | undefined> {
    return structuredClone(this.value) as T | undefined;
  }

  async put<T>(_key: string, value: T): Promise<void> {
    this.value = structuredClone(value);
  }
}

function setupBudget() {
  const storage = new MemoryBudgetStorage();
  const budget = new VoiceBudget({ storage });
  const request = async (path: string, limitMinutes: number, sessionId?: string) => {
    const response = await budget.fetch(new Request(
      `https://budget.test${path}?limitMinutes=${limitMinutes}`,
      {
        method: path === '/snapshot' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(sessionId ? { body: JSON.stringify({ sessionId }) } : {}),
      }
    ));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { request, storage };
}

describe('VoiceBudget', () => {
  afterEach(() => vi.useRealTimers());

  it('reserves idempotently and rounds active and completed participant-minutes up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
    const { request } = setupBudget();

    const first = await request('/reserve', 20, 'room:seat');
    const repeated = await request('/reserve', 20, 'room:seat');
    expect(first.body).toMatchObject({ ok: true, snapshot: { activeMinutes: 1, totalMinutes: 1 } });
    expect(repeated.body).toMatchObject({ ok: true, snapshot: { activeMinutes: 1, totalMinutes: 1 } });

    vi.setSystemTime(new Date('2026-01-03T00:01:01.000Z'));
    const checkpoint = await request('/checkpoint', 20, 'room:seat');
    expect(checkpoint.body).toMatchObject({ ok: true, snapshot: { activeMinutes: 2, totalMinutes: 2 } });

    vi.setSystemTime(new Date('2026-01-03T00:01:12.000Z'));
    const left = await request('/leave', 20, 'room:seat');
    const repeatedLeave = await request('/leave', 20, 'room:seat');
    expect(left.body).toMatchObject({ ok: true, snapshot: { usedMinutes: 2, activeMinutes: 0, totalMinutes: 2 } });
    expect(repeatedLeave.body).toMatchObject({ ok: false, snapshot: { usedMinutes: 2, totalMinutes: 2 } });
  });

  it('warns at 80 percent and blocks reservations at the configured cap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
    const { request } = setupBudget();

    for (const seat of ['one', 'two', 'three', 'four']) {
      await request('/reserve', 5, seat);
    }
    const warning = await request('/snapshot', 5);
    expect(warning.body).toMatchObject({ warning: true, totalMinutes: 4, limitMinutes: 5 });

    await request('/reserve', 5, 'five');
    const blocked = await request('/reserve', 5, 'six');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ ok: false, code: 'VOICE_BUDGET_REACHED' });
  });

  it('does not charge a reserved session that never became active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
    const { request } = setupBudget();
    await request('/reserve', 20, 'room:failed-join');

    const released = await request('/leave', 20, 'room:failed-join');
    expect(released.body).toMatchObject({ ok: true, snapshot: { usedMinutes: 0, activeMinutes: 0, totalMinutes: 0 } });
  });

  it('resets monthly usage on the UTC month boundary without charging pre-boundary time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T23:59:30.000Z'));
    const { request } = setupBudget();
    await request('/reserve', 20, 'room:seat');
    await request('/checkpoint', 20, 'room:seat');

    vi.setSystemTime(new Date('2026-02-01T00:10:00.000Z'));
    const snapshot = await request('/snapshot', 20);
    expect(snapshot.body).toMatchObject({
      month: '2026-02',
      usedMinutes: 0,
      activeMinutes: 1,
      totalMinutes: 1,
    });
    const left = await request('/leave', 20, 'room:seat');
    expect(left.body).toMatchObject({ snapshot: { month: '2026-02', usedMinutes: 1 } });
  });

  it('rejects invalid limits and malformed session requests', async () => {
    const { request } = setupBudget();
    expect((await request('/snapshot', 0)).status).toBe(400);
    expect((await request('/reserve', 10)).status).toBe(400);
  });
});

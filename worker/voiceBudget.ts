/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface BudgetStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface BudgetStateLike {
  storage: BudgetStorage;
}

interface ActiveVoiceSession {
  startedAt: number;
  elapsedMs: number;
  activated?: boolean;
}

interface StoredBudget {
  month: string;
  usedMinutes: number;
  active: Record<string, ActiveVoiceSession>;
}

interface BudgetSnapshot {
  month: string;
  limitMinutes: number;
  usedMinutes: number;
  activeMinutes: number;
  totalMinutes: number;
  warning: boolean;
}

function monthFor(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export class VoiceBudget {
  constructor(private readonly state: BudgetStateLike) {}

  private async load(now: number): Promise<{ budget: StoredBudget; changed: boolean }> {
    const stored = await this.state.storage.get<StoredBudget>('budget');
    const currentMonth = monthFor(now);
    if (!stored) {
      return { budget: { month: currentMonth, usedMinutes: 0, active: {} }, changed: true };
    }
    if (stored.month !== currentMonth) {
      const active = Object.fromEntries(
        Object.entries(stored.active).map(([id, session]) => [
          id,
          { startedAt: now, elapsedMs: 0, activated: session.activated === true },
        ])
      );
      return { budget: { month: currentMonth, usedMinutes: 0, active }, changed: true };
    }
    return { budget: stored, changed: false };
  }

  private activeMinutes(budget: StoredBudget, now: number): number {
    return Object.values(budget.active).reduce((total, session) => {
      const elapsedMs = session.elapsedMs + Math.max(0, now - session.startedAt);
      return total + Math.max(1, Math.ceil(elapsedMs / 60_000));
    }, 0);
  }

  private snapshot(budget: StoredBudget, now: number, limitMinutes: number): BudgetSnapshot {
    const activeMinutes = this.activeMinutes(budget, now);
    const totalMinutes = budget.usedMinutes + activeMinutes;
    return {
      month: budget.month,
      limitMinutes,
      usedMinutes: budget.usedMinutes,
      activeMinutes,
      totalMinutes,
      warning: totalMinutes >= Math.ceil(limitMinutes * 0.8),
    };
  }

  private async saveIfChanged(budget: StoredBudget, changed: boolean): Promise<void> {
    if (changed) await this.state.storage.put('budget', budget);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    const { budget, changed } = await this.load(now);
    const limitMinutes = Number(url.searchParams.get('limitMinutes'));
    if (!Number.isSafeInteger(limitMinutes) || limitMinutes < 1) {
      return jsonResponse({ error: 'Budget configuration is invalid.' }, 400);
    }

    if (url.pathname === '/snapshot' && request.method === 'GET') {
      await this.saveIfChanged(budget, changed);
      return jsonResponse(this.snapshot(budget, now, limitMinutes));
    }
    if (request.method !== 'POST') return jsonResponse({ error: 'Not found.' }, 404);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse({ error: 'Invalid budget request.' }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'Invalid budget request.' }, 400);
    }

    if (url.pathname === '/reserve') {
      if (typeof body.sessionId !== 'string' || body.sessionId.length < 1 || body.sessionId.length > 200) {
        return jsonResponse({ error: 'Invalid budget request.' }, 400);
      }
      if (budget.active[body.sessionId]) {
        await this.saveIfChanged(budget, changed);
        return jsonResponse({ ok: true, snapshot: this.snapshot(budget, now, limitMinutes) });
      }
      if (this.snapshot(budget, now, limitMinutes).totalMinutes >= limitMinutes) {
        return jsonResponse({ ok: false, code: 'VOICE_BUDGET_REACHED', snapshot: this.snapshot(budget, now, limitMinutes) }, 429);
      }
      budget.active[body.sessionId] = { startedAt: now, elapsedMs: 0, activated: false };
      await this.state.storage.put('budget', budget);
      return jsonResponse({ ok: true, snapshot: this.snapshot(budget, now, limitMinutes) });
    }

    if (url.pathname === '/checkpoint') {
      if (typeof body.sessionId !== 'string') return jsonResponse({ error: 'Invalid budget request.' }, 400);
      const session = budget.active[body.sessionId];
      if (session) {
        session.elapsedMs += Math.max(0, now - session.startedAt);
        session.startedAt = now;
        session.activated = true;
        await this.state.storage.put('budget', budget);
      } else await this.saveIfChanged(budget, changed);
      return jsonResponse({ ok: Boolean(session), snapshot: this.snapshot(budget, now, limitMinutes) });
    }

    if (url.pathname === '/leave') {
      if (typeof body.sessionId !== 'string') return jsonResponse({ error: 'Invalid budget request.' }, 400);
      const session = budget.active[body.sessionId];
      if (session) {
        const elapsedMs = session.elapsedMs + Math.max(0, now - session.startedAt);
        budget.usedMinutes += session.activated
          ? Math.max(1, Math.ceil(elapsedMs / 60_000))
          : Math.ceil(elapsedMs / 60_000);
        delete budget.active[body.sessionId];
        await this.state.storage.put('budget', budget);
      } else await this.saveIfChanged(budget, changed);
      return jsonResponse({ ok: Boolean(session), snapshot: this.snapshot(budget, now, limitMinutes) });
    }

    return jsonResponse({ error: 'Not found.' }, 404);
  }
}

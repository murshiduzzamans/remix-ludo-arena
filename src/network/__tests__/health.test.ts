import { describe, expect, it } from 'vitest';
import worker from '../../../worker/index';

describe('worker health check', () => {
  it('responds to GET /api/health with ok status and version', async () => {
    const response = await worker.fetch(new Request('https://ludo.example/api/health'), {} as never);
    expect(response.status).toBe(200);
    const data = await response.json() as { status: string; version: string; timestamp: number };
    expect(data.status).toBe('ok');
    expect(data.version).toBe('1.0.0');
    expect(typeof data.timestamp).toBe('number');
  });
});

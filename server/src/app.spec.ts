import { afterAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@ninja/shared';
import { createApp } from './app.js';

const app = createApp({ logLevel: 'silent' });
afterAll(() => app.close());

describe('GET /health', () => {
  it('trả 200 kèm trạng thái ok và phiên bản protocol', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(typeof body.uptimeSeconds).toBe('number');
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@ninja/shared';

export interface AppOptions {
  logLevel?: string;
  corsOrigin?: string;
}

/** Tạo instance Fastify. Tách khỏi main.ts để kiểm thử bằng app.inject(). */
export function createApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: { level: options.logLevel ?? 'info' } });

  app.get('/health', async () => ({
    status: 'ok',
    protocolVersion: PROTOCOL_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/version', async () => ({
    protocolVersion: PROTOCOL_VERSION,
    corsOrigin: options.corsOrigin ?? null,
  }));

  return app;
}

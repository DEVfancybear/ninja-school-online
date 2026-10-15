import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { CharacterClass, School } from '@ninja/shared';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { getTestDb, TEST_DATABASE_URL } from './database.js';

/** Mật khẩu của tài khoản kiểm thử (đủ dài theo schema đăng ký). */
const TEST_SECRET = 'matkhau123';

export interface TestServer {
  readonly app: FastifyInstance;
  readonly port: number;
  /** Địa chỉ WebSocket của game: `ws://127.0.0.1:<cổng>/ws`. */
  readonly wsUrl: string;
  close(): Promise<void>;
}

export interface TestServerOptions {
  handshakeTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  gameDataDir?: string;
}

/**
 * Dựng server thật trên cổng 0 (hệ điều hành cấp cổng) và trả địa chỉ WebSocket. Kiểm thử
 * WebSocket phải đi qua mạng thật vì luồng bắt tay/upgrade không mô phỏng được bằng `app.inject()`.
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const db = await getTestDb();
  const app = await createApp({
    env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: TEST_DATABASE_URL }),
    db,
    gameDataDir: options.gameDataDir,
    websocket: {
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });

  const address = app.server.address() as AddressInfo | null;
  const port = address?.port ?? 0;

  return {
    app,
    port,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: () => app.close(),
  };
}

/** Đăng ký một tài khoản qua REST API rồi trả access token để dùng cho `C2S_HELLO`. */
export async function registerAccount(app: FastifyInstance, username: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: TEST_SECRET },
  });
  if (response.statusCode !== 201) {
    throw new Error(
      `đăng ký tài khoản kiểm thử thất bại (${response.statusCode}): ${response.body}`,
    );
  }
  return response.json().accessToken as string;
}

/** Tạo nhân vật qua REST API (đúng luồng thật của người chơi) rồi trả id nhân vật. */
export async function createCharacter(
  app: FastifyInstance,
  access: string,
  name: string,
  school: School = 'haruna',
  characterClass: CharacterClass = 'dao',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/characters',
    headers: { authorization: `Bearer ${access}` },
    payload: { name, school, class: characterClass },
  });
  if (response.statusCode !== 201) {
    throw new Error(`tạo nhân vật kiểm thử thất bại (${response.statusCode}): ${response.body}`);
  }
  return (response.json() as { character: { id: string } }).character.id;
}

/** Tài khoản đã có nhân vật: trả về access token và id nhân vật. */
export async function accountWithCharacter(
  app: FastifyInstance,
  username: string,
  characterName: string,
): Promise<{ access: string; characterId: string }> {
  const access = await registerAccount(app, username);
  const characterId = await createCharacter(app, access, characterName);
  return { access, characterId };
}

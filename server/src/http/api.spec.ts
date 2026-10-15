import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { closeTestDb, getTestDb, resetDatabase, TEST_DATABASE_URL } from '../test/database.js';

let app: FastifyInstance;

const CREDENTIALS = { username: 'ninja_01', password: 'matkhau123' };

beforeAll(async () => {
  const db = await getTestDb();
  app = await createApp({
    env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: TEST_DATABASE_URL }),
    db,
  });
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

async function register(username = CREDENTIALS.username, password = CREDENTIALS.password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  });
  return res;
}

/** Đăng ký một tài khoản và trả access token để gọi các route cần đăng nhập. */
async function registerAndGetToken(): Promise<string> {
  const res = await register();
  return res.json().accessToken as string;
}

describe('GET /health', () => {
  it('báo database đang hoạt động', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up', protocolVersion: 1 });
  });
});

describe('GET /version', () => {
  it('trả phiên bản protocol để client kiểm tra tương thích', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json().protocolVersion).toBe(1);
  });
});

describe('POST /api/auth/register', () => {
  it('tạo tài khoản và trả về phiên đăng nhập', async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.account.username).toBe(CREDENTIALS.username);
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(res.body).not.toContain(CREDENTIALS.password);
  });

  it('trả 409 khi tên đăng nhập đã tồn tại', async () => {
    await register();
    const res = await register();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('conflict');
  });

  it('trả 400 kèm mô tả tiếng Việt khi mật khẩu quá ngắn', async () => {
    const res = await register('ninja_01', 'ngan');
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation_error');
    expect(body.message).toContain('mật khẩu');
  });

  it('trả 400 khi tên đăng nhập có ký tự không hợp lệ', async () => {
    const res = await register('Ninja 01', 'matkhau123');
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('đăng nhập thành công trả phiên mới', async () => {
    await register();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: CREDENTIALS });
    expect(res.statusCode).toBe(200);
    expect(res.json().account.username).toBe(CREDENTIALS.username);
  });

  it('trả 401 khi sai mật khẩu', async () => {
    await register();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: CREDENTIALS.username, password: 'sai-mat-khau' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });
});

describe('GET /api/auth/me', () => {
  it('trả 401 khi thiếu token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('trả 401 khi token không hợp lệ', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer token-gia' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('trả thông tin tài khoản khi có token hợp lệ', async () => {
    const token = await registerAndGetToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().account.username).toBe(CREDENTIALS.username);
  });
});

describe('/api/characters', () => {
  it('yêu cầu đăng nhập', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/characters' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/characters',
          payload: { name: 'HoaLong', school: 'haruna', class: 'dao' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('tạo rồi liệt kê nhân vật trong cùng một phiên', async () => {
    const token = await registerAndGetToken();
    const created = await app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'HoaLong', school: 'haruna', class: 'dao' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().character).toMatchObject({
      name: 'HoaLong',
      school: 'haruna',
      class: 'dao',
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/characters',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().characters).toHaveLength(1);
  });

  it('trả 400 khi phái không thuộc trường đã chọn', async () => {
    const token = await registerAndGetToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'HoaLong', school: 'haruna', class: 'kunai' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('haruna');
  });

  it('trả 409 khi tên nhân vật đã có người dùng', async () => {
    const token = await registerAndGetToken();
    const payload = { name: 'HoaLong', school: 'haruna', class: 'dao' };
    await app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, name: 'hoalong' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('trả 404 cho đường dẫn không tồn tại', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/khong-co-that' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import { AppError } from '../../errors.js';
import { argon2PasswordHasher } from '../../security/password.js';
import { TokenService } from '../../security/tokens.js';
import { AccountService } from './service.js';

let service: AccountService;

async function createService(): Promise<AccountService> {
  const db = await getTestDb();
  return new AccountService({
    db,
    hasher: argon2PasswordHasher,
    tokens: new TokenService(db, { refreshTtlDays: 30 }),
    signAccessToken: (payload) => `access:${payload.sub}`,
  });
}

beforeEach(async () => {
  await resetDatabase();
  service = await createService();
});

afterAll(async () => {
  await closeTestDb();
});

describe('AccountService.register', () => {
  it('tạo tài khoản, không trả về hash mật khẩu, và cấp token', async () => {
    const session = await service.register({ username: 'ninja_01', password: 'matkhau123' });
    expect(session.account.username).toBe('ninja_01');
    expect(session.accessToken).toBe(`access:${session.account.id}`);
    expect(session.refreshToken).toHaveLength(43);
    expect(JSON.stringify(session)).not.toContain('matkhau123');
  });

  it('từ chối tên đăng nhập đã tồn tại (không phân biệt hoa thường)', async () => {
    await service.register({ username: 'ninja_01', password: 'matkhau123' });
    await expect(
      service.register({ username: 'NINJA_01', password: 'matkhau456' }),
    ).rejects.toThrow(AppError);
  });

  it('băm mật khẩu bằng argon2id, không lưu dạng thô', async () => {
    const session = await service.register({ username: 'ninja_01', password: 'matkhau123' });
    const row = await service.findById(session.account.id);
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain('matkhau123');
  });
});

describe('AccountService.login', () => {
  it('đăng nhập đúng mật khẩu thì trả phiên mới', async () => {
    const created = await service.register({ username: 'ninja_01', password: 'matkhau123' });
    const session = await service.login({ username: 'ninja_01', password: 'matkhau123' });
    expect(session.account.id).toBe(created.account.id);
    expect(session.refreshToken).not.toBe(created.refreshToken);
  });

  it('nhận tên đăng nhập khác hoa thường', async () => {
    await service.register({ username: 'ninja_01', password: 'matkhau123' });
    const session = await service.login({ username: 'Ninja_01', password: 'matkhau123' });
    expect(session.account.username).toBe('ninja_01');
  });

  it('sai mật khẩu thì báo lỗi 401', async () => {
    await service.register({ username: 'ninja_01', password: 'matkhau123' });
    await expect(
      service.login({ username: 'ninja_01', password: 'sai-mat-khau' }),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('tài khoản không tồn tại cũng trả cùng thông báo như sai mật khẩu', async () => {
    await service.register({ username: 'ninja_01', password: 'matkhau123' });
    const wrongPassword = await service
      .login({ username: 'ninja_01', password: 'sai' })
      .catch((e: AppError) => e);
    const noAccount = await service
      .login({ username: 'khong_ton_tai', password: 'matkhau123' })
      .catch((e: AppError) => e);
    expect((wrongPassword as AppError).message).toBe((noAccount as AppError).message);
  });
});

describe('AccountService.refresh và logout', () => {
  it('xoay refresh token: token cũ không dùng lại được', async () => {
    const session = await service.register({ username: 'ninja_01', password: 'matkhau123' });
    const refreshed = await service.refresh(session.refreshToken);
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    expect(refreshed.account.id).toBe(session.account.id);
    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refresh token không tồn tại thì bị từ chối', async () => {
    await expect(service.refresh('token-khong-co-that')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('sau khi đăng xuất thì refresh token không dùng được nữa', async () => {
    const session = await service.register({ username: 'ninja_01', password: 'matkhau123' });
    await service.logout(session.refreshToken);
    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refresh token hết hạn thì bị từ chối', async () => {
    const db = await getTestDb();
    const pastTokens = new TokenService(db, {
      refreshTtlDays: 30,
      now: () => new Date(Date.now() - 31 * 86400000),
    });
    const session = await service.register({ username: 'ninja_01', password: 'matkhau123' });
    expect(session.refreshToken).toBeTruthy();
    // Token dưới đây được phát hành với đồng hồ lùi 31 ngày nên đã hết hạn.
    const expired = await pastTokens.issueRefreshToken(session.account.id);
    await expect(service.refresh(expired)).rejects.toMatchObject({ statusCode: 401 });
  });
});

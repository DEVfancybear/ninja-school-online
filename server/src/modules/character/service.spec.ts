import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_CHARACTERS_PER_ACCOUNT } from '@ninja/shared';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import { AppError } from '../../errors.js';
import { accounts } from '../../db/schema.js';
import { DEFAULT_GAME_DATA_DIR, loadGameData } from '../../world/game-data.js';
import { InventoryService } from '../inventory/service.js';
import { CharacterService } from './service.js';

let service: CharacterService;
let accountId: string;

beforeEach(async () => {
  await resetDatabase();
  const db = await getTestDb();
  const gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  service = new CharacterService(db, new InventoryService(db, gameData), gameData);
  const [account] = await db
    .insert(accounts)
    .values({ username: 'ninja_01', passwordHash: '$argon2id$fake' })
    .returning();
  accountId = account!.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('CharacterService.create', () => {
  it('tạo nhân vật đúng trường, phái và chỉ số khởi đầu', async () => {
    const character = await service.create(accountId, {
      name: 'HoaLong',
      school: 'haruna',
      class: 'dao',
    });
    expect(character).toMatchObject({
      name: 'HoaLong',
      school: 'haruna',
      class: 'dao',
      level: 1,
      exp: 0,
    });
    expect(character.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('từ chối tên nhân vật trùng (không phân biệt hoa thường)', async () => {
    await service.create(accountId, { name: 'HoaLong', school: 'haruna', class: 'dao' });
    await expect(
      service.create(accountId, { name: 'hoalong', school: 'ookaza', class: 'cung' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('cho phép hai tài khoản khác nhau dùng cùng tên nhân vật? (không — tên là duy nhất toàn máy chủ)', async () => {
    const db = await getTestDb();
    const [other] = await db
      .insert(accounts)
      .values({ username: 'ninja_02', passwordHash: '$argon2id$fake' })
      .returning();
    await service.create(accountId, { name: 'HoaLong', school: 'haruna', class: 'dao' });
    await expect(
      service.create(other!.id, { name: 'HoaLong', school: 'haruna', class: 'dao' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('chặn khi tài khoản đã đủ số nhân vật tối đa', async () => {
    const schools = [
      { name: 'NhanVat1', school: 'haruna', class: 'dao' },
      { name: 'NhanVat2', school: 'haruna', class: 'quat' },
      { name: 'NhanVat3', school: 'hirosaki', class: 'kiem' },
      { name: 'NhanVat4', school: 'ookaza', class: 'cung' },
    ] as const;
    for (const input of schools) {
      await service.create(accountId, input);
    }
    expect(await service.list(accountId)).toHaveLength(MAX_CHARACTERS_PER_ACCOUNT);
    await expect(
      service.create(accountId, { name: 'NhanVat5', school: 'ookaza', class: 'kunai' }),
    ).rejects.toThrow(AppError);
  });
});

describe('CharacterService.list', () => {
  it('chỉ trả nhân vật của tài khoản được hỏi', async () => {
    const db = await getTestDb();
    const [other] = await db
      .insert(accounts)
      .values({ username: 'ninja_02', passwordHash: '$argon2id$fake' })
      .returning();
    await service.create(accountId, { name: 'CuaToi', school: 'haruna', class: 'dao' });
    await service.create(other!.id, { name: 'CuaNguoiKhac', school: 'ookaza', class: 'cung' });

    const mine = await service.list(accountId);
    expect(mine.map((c) => c.name)).toEqual(['CuaToi']);
  });

  it('tài khoản mới thì danh sách rỗng', async () => {
    expect(await service.list(accountId)).toEqual([]);
  });
});

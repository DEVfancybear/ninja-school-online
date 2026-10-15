import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { closeTestDb, getTestDb, TEST_DATABASE_URL } from '../test/database.js';
import { DEFAULT_GAME_DATA_DIR, GameDataError, loadGameData } from './game-data.js';

const temporaryDirs: string[] = [];

/** Tạo một thư mục game-data tạm từ các file cho trước (đường dẫn tương đối → nội dung JSON). */
async function makeGameDataDir(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ninja-game-data-'));
  temporaryDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    if (content === undefined) {
      // `undefined` = cố ý không tạo file này (dùng để thử dữ liệu thiếu).
      continue;
    }
    const fullPath = join(dir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

async function readGameDataFile(relativePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(DEFAULT_GAME_DATA_DIR, relativePath), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Bản sao dữ liệu thật, sửa bằng `mutate` để tạo ca sai có kiểm soát. */
async function copyWithChange(
  mutate: (maps: Record<string, unknown>[], npcs: Record<string, unknown>[]) => void,
): Promise<string> {
  const maps = [
    await readGameDataFile('maps/lang-khoi-nguon.json'),
    await readGameDataFile('maps/bai-luyen-tap.json'),
  ];
  const npcs = [await readGameDataFile('npcs/npc-thay-hieu-truong.json')];
  mutate(maps, npcs);
  return makeGameDataDir({
    'maps/lang-khoi-nguon.json': maps[0],
    'maps/bai-luyen-tap.json': maps[1],
    'npcs/npc-thay-hieu-truong.json': npcs[0],
  });
}

afterAll(async () => {
  for (const dir of temporaryDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  await closeTestDb();
});

describe('nạp game-data', () => {
  it('nạp và kiểm được dữ liệu thật của repo', async () => {
    const data = await loadGameData();

    expect([...data.maps.keys()].sort()).toEqual(['bai-luyen-tap', 'lang-khoi-nguon']);
    expect([...data.npcs.keys()]).toEqual(['npc-thay-hieu-truong']);

    const village = data.maps.get('lang-khoi-nguon');
    expect(village?.width).toBe(40);
    expect(village?.height).toBe(30);
    expect(village?.tileSize).toBe(32);
    expect(village?.spawns.map((spawn) => spawn.id)).toEqual(['default', 'cong-bai-luyen-tap']);
    expect(village?.npcs[0]?.id).toBe('npc-thay-hieu-truong');
  });

  it('cổng dẫn tới bản đồ không tồn tại → lỗi ghi rõ file và trường', async () => {
    const dir = await copyWithChange((maps) => {
      const village = maps[0] as { portals: { toMap: string }[] };
      village.portals[0]!.toMap = 'khong-co-ban-do-nay';
    });

    const error = await loadGameData(dir).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(GameDataError);
    const issues = (error as GameDataError).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({
        file: 'maps/lang-khoi-nguon.json',
        path: 'portals.toi-bai-luyen-tap.toMap',
      }),
    );
    expect((error as GameDataError).message).toContain('khong-co-ban-do-nay');
  });

  it('cổng trỏ tới điểm spawn không có → lỗi', async () => {
    const dir = await copyWithChange((maps) => {
      const village = maps[0] as { portals: { toSpawn: string }[] };
      village.portals[0]!.toSpawn = 'khong-co-spawn';
    });

    await expect(loadGameData(dir)).rejects.toThrow(/toSpawn/);
  });

  it('dữ liệu sai schema → lỗi kèm đúng file và trường', async () => {
    const dir = await copyWithChange((maps) => {
      maps[0]!.width = 999; // ground vẫn 40 cột → sai kích thước
    });

    const error = (await loadGameData(dir).catch((thrown: unknown) => thrown)) as GameDataError;
    expect(error).toBeInstanceOf(GameDataError);
    expect(error.issues.some((issue) => issue.file === 'maps/lang-khoi-nguon.json')).toBe(true);
    expect(error.issues.some((issue) => issue.path.startsWith('ground'))).toBe(true);
  });

  it('NPC đặt trên map nhưng thiếu file hội thoại → lỗi', async () => {
    const dir = await copyWithChange((_maps, npcs) => {
      // Đổi id file hội thoại: NPC đặt trên map không còn dữ liệu tương ứng.
      npcs[0]!.id = 'npc-khac';
    });

    const error = (await loadGameData(dir).catch((thrown: unknown) => thrown)) as GameDataError;
    expect(error).toBeInstanceOf(GameDataError);
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        file: 'maps/lang-khoi-nguon.json',
        path: 'npcs.npc-thay-hieu-truong',
      }),
    );
  });

  it('thiếu hẳn thư mục maps → lỗi nói rõ đường dẫn', async () => {
    const dir = await makeGameDataDir({});
    await expect(loadGameData(dir)).rejects.toThrow(/maps/);
  });

  it('game-data sai thì server không khởi động được', async () => {
    const dir = await copyWithChange((maps) => {
      maps.pop(); // xoá bãi luyện tập: cổng ở làng trỏ vào khoảng không
    });
    const db = await getTestDb();

    await expect(
      createApp({
        env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: TEST_DATABASE_URL }),
        db,
        gameDataDir: dir,
      }),
    ).rejects.toBeInstanceOf(GameDataError);
  });
});

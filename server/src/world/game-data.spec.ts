import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { closeTestDb, getTestDb, TEST_DATABASE_URL } from '../test/database.js';
import { DEFAULT_GAME_DATA_DIR, GameDataError, loadGameData } from './game-data.js';

const temporaryDirs: string[] = [];

/** Các thư mục con của game-data; bản sao dùng cho test phải có **đủ cả sáu**. */
const COLLECTION_DIRS = ['maps', 'npcs', 'monsters', 'skills', 'items', 'classes'] as const;

type CollectionDir = (typeof COLLECTION_DIRS)[number];

/** Nội dung một bộ game-data, khoá theo đường dẫn tương đối (`maps/lang-khoi-nguon.json`). */
type GameDataFiles = Record<CollectionDir, Record<string, Record<string, unknown>>>;

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

/**
 * Bản sao **đầy đủ** dữ liệu thật (mọi thư mục con), sửa bằng `mutate` để tạo ca sai có kiểm soát.
 * Bản sao thiếu thư mục sẽ tự báo lỗi "quái trên bản đồ chưa có file", không phải điều cần thử ở đây.
 */
async function copyGameDataDir(mutate: (files: GameDataFiles) => void): Promise<string> {
  const files = {
    maps: {},
    npcs: {},
    monsters: {},
    skills: {},
    items: {},
    classes: {},
  } as GameDataFiles;
  for (const dir of COLLECTION_DIRS) {
    for (const name of (await readdir(join(DEFAULT_GAME_DATA_DIR, dir))).sort()) {
      if (name.endsWith('.json')) {
        files[dir][`${dir}/${name}`] = await readGameDataFile(`${dir}/${name}`);
      }
    }
  }
  mutate(files);
  return makeGameDataDir(Object.assign({}, ...COLLECTION_DIRS.map((dir) => files[dir])));
}

const VILLAGE = 'maps/lang-khoi-nguon.json';
const TRAINING = 'maps/bai-luyen-tap.json';

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
    expect([...data.monsters.keys()].sort()).toEqual([
      'mob-bui-nhon',
      'mob-chuot-dong',
      'mob-heo-rung',
    ]);
    expect([...data.classes.keys()].sort()).toEqual(['haruna', 'hirosaki', 'ookaza']);
    expect(data.items.size).toBeGreaterThan(0);
    expect(data.skills.size).toBeGreaterThan(0);

    const village = data.maps.get('lang-khoi-nguon');
    expect(village?.width).toBe(40);
    expect(village?.height).toBe(30);
    expect(village?.tileSize).toBe(32);
    expect(village?.spawns.map((spawn) => spawn.id)).toEqual(['default', 'cong-bai-luyen-tap']);
    expect(village?.npcs[0]?.id).toBe('npc-thay-hieu-truong');
    expect(village?.monsters.map((monster) => monster.id)).toContain('mob-chuot-dong');
  });

  it('cổng dẫn tới bản đồ không tồn tại → lỗi ghi rõ file và trường', async () => {
    const dir = await copyGameDataDir((files) => {
      const village = files.maps[VILLAGE] as { portals: { toMap: string }[] };
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
    const dir = await copyGameDataDir((files) => {
      const village = files.maps[VILLAGE] as { portals: { toSpawn: string }[] };
      village.portals[0]!.toSpawn = 'khong-co-spawn';
    });

    await expect(loadGameData(dir)).rejects.toThrow(/toSpawn/);
  });

  it('bản đồ đặt quái chưa có file dữ liệu → lỗi chỉ đúng chỗ đặt', async () => {
    const dir = await copyGameDataDir((files) => {
      files.monsters['monsters/mob-chuot-dong.json']!.id = 'mob-khac';
    });

    const error = (await loadGameData(dir).catch((thrown: unknown) => thrown)) as GameDataError;
    expect(error).toBeInstanceOf(GameDataError);
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        file: 'maps/lang-khoi-nguon.json',
        path: 'monsters.mob-chuot-dong',
      }),
    );
  });

  it('quái rơi vật phẩm không có file → lỗi', async () => {
    const dir = await copyGameDataDir((files) => {
      const monster = files.monsters['monsters/mob-bui-nhon.json'] as {
        drops: { itemId: string }[];
      };
      monster.drops[0]!.itemId = 'item-khong-co';
    });

    await expect(loadGameData(dir)).rejects.toThrow(/item-khong-co/);
  });

  it('dữ liệu sai schema → lỗi kèm đúng file và trường', async () => {
    const dir = await copyGameDataDir((files) => {
      files.maps[VILLAGE]!.width = 999; // ground vẫn 40 cột → sai kích thước
    });

    const error = (await loadGameData(dir).catch((thrown: unknown) => thrown)) as GameDataError;
    expect(error).toBeInstanceOf(GameDataError);
    expect(error.issues.some((issue) => issue.file === 'maps/lang-khoi-nguon.json')).toBe(true);
    expect(error.issues.some((issue) => issue.path.startsWith('ground'))).toBe(true);
  });

  it('NPC đặt trên map nhưng thiếu file hội thoại → lỗi', async () => {
    const dir = await copyGameDataDir((files) => {
      // Đổi id file hội thoại: NPC đặt trên map không còn dữ liệu tương ứng.
      files.npcs['npcs/npc-thay-hieu-truong.json']!.id = 'npc-khac';
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
    const dir = await copyGameDataDir((files) => {
      delete files.maps[TRAINING]; // xoá bãi luyện tập: cổng ở làng trỏ vào khoảng không
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

import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { closeTestDb, getTestDb, TEST_DATABASE_URL } from '../test/database.js';
import {
  copyGameDataDir,
  makeGameDataDir,
  removeTemporaryGameDataDirs,
} from '../test/game-data-dir.js';
import { GameDataError, loadGameData } from './game-data.js';

const VILLAGE = 'maps/lang-khoi-nguon.json';
const TRAINING = 'maps/bai-luyen-tap.json';

afterAll(async () => {
  await removeTemporaryGameDataDirs();
  await closeTestDb();
});

describe('nạp game-data', () => {
  it('nạp và kiểm được dữ liệu thật của repo', async () => {
    const data = await loadGameData();

    expect([...data.maps.keys()].sort()).toEqual(['bai-luyen-tap', 'lang-khoi-nguon']);
    expect([...data.npcs.keys()].sort()).toEqual([
      'npc-su-phu',
      'npc-thay-do',
      'npc-thay-hieu-truong',
    ]);
    expect([...data.monsters.keys()].sort()).toEqual([
      'mob-bui-nhon',
      'mob-chuot-dong',
      'mob-heo-rung',
      'mob-thu-vuong',
    ]);
    expect([...data.classes.keys()].sort()).toEqual(['haruna', 'hirosaki', 'ookaza']);
    expect(data.items.size).toBeGreaterThan(0);
    expect(data.skills.size).toBeGreaterThan(0);
    // Chương 1 của chính tuyến: mở đầu ở làng và kết thúc bằng lễ bái sư.
    expect([...data.quests.keys()]).toContain('quest-chao-lang');
    expect([...data.quests.keys()]).toContain('quest-bai-su');

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

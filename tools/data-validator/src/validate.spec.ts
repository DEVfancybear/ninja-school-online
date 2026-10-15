import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateGameData } from './validate.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ninja-data-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(relPath: string, content: unknown): Promise<void> {
  const full = join(dir, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
}

const skill = {
  id: 'skill-tram-co-ban',
  name: 'Trảm Cơ Bản',
  school: 'haruna',
  class: 'dao',
  type: 'active',
  levelRequired: 1,
  costMp: 5,
  cooldownMs: 0,
  targets: 1,
  power: 10,
  scale: { stat: 'strength', factor: 1.2 },
};

describe('validateGameData', () => {
  it('bỏ qua khi thư mục chưa có dữ liệu', async () => {
    expect(await validateGameData(dir)).toEqual({ checked: 0, errors: [] });
  });

  it('chấp nhận dữ liệu hợp lệ', async () => {
    await write('skills/skill-tram-co-ban.json', skill);
    const result = await validateGameData(dir);
    expect(result.checked).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('báo lỗi kèm đường dẫn trường sai', async () => {
    await write('skills/skill-loi.json', { ...skill, id: 'skill-loi', costMp: -3 });
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: 'skills/skill-loi.json', path: 'costMp' });
  });

  it('báo lỗi khi file không phải JSON hợp lệ', async () => {
    await write('items/item-hong.json', '{ khong-phai-json');
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/JSON không hợp lệ/);
  });
});

/** Bản đồ 8x8 tối thiểu hợp lệ, đổi được vài trường để kiểm các trường hợp liên-map. */
function mapFixture(id: string, overrides: Record<string, unknown> = {}) {
  const size = 8;
  const ground = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  return {
    id,
    name: `Bản đồ ${id}`,
    width: size,
    height: size,
    tiles: [
      { id: 0, name: 'cỏ', color: '#2f5d3a', blocked: false },
      { id: 1, name: 'tường', color: '#6b4a2f', blocked: true },
    ],
    ground,
    spawns: [{ id: 'default', x: 1, y: 1 }],
    ...overrides,
  };
}

function npcFixture(id: string) {
  return {
    id,
    name: 'Thầy Hiệu Trưởng',
    color: '#e0b457',
    lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Chào mừng con.' }],
  };
}

describe('validateGameData — kiểm liên-map', () => {
  it('chấp nhận hai bản đồ nối nhau qua cổng có thật', async () => {
    await write(
      'maps/map-mot.json',
      mapFixture('map-mot', {
        spawns: [
          { id: 'default', x: 1, y: 1 },
          { id: 'cong-ve', x: 2, y: 2 },
        ],
        portals: [
          { id: 'c1', x: 7, y: 0, width: 1, height: 8, toMap: 'map-hai', toSpawn: 'default' },
        ],
      }),
    );
    await write(
      'maps/map-hai.json',
      mapFixture('map-hai', {
        portals: [
          { id: 'c2', x: 0, y: 0, width: 1, height: 8, toMap: 'map-mot', toSpawn: 'cong-ve' },
        ],
      }),
    );

    expect(await validateGameData(dir)).toEqual({ checked: 2, errors: [] });
  });

  it('báo lỗi khi cổng dẫn tới bản đồ không tồn tại', async () => {
    await write(
      'maps/map-mot.json',
      mapFixture('map-mot', {
        portals: [
          { id: 'c1', x: 7, y: 0, width: 1, height: 8, toMap: 'map-khong-co', toSpawn: 'default' },
        ],
      }),
    );
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: 'maps/map-mot.json' });
    expect(result.errors[0]?.message).toContain('map-khong-co');
  });

  it('báo lỗi khi bản đồ đích không có điểm spawn mà cổng trỏ tới', async () => {
    await write(
      'maps/map-mot.json',
      mapFixture('map-mot', {
        portals: [
          { id: 'c1', x: 7, y: 0, width: 1, height: 8, toMap: 'map-hai', toSpawn: 'khong-ton-tai' },
        ],
      }),
    );
    await write('maps/map-hai.json', mapFixture('map-hai'));
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('khong-ton-tai');
  });

  it('báo lỗi khi bản đồ đặt NPC chưa có file hội thoại', async () => {
    await write(
      'maps/map-mot.json',
      mapFixture('map-mot', { npcs: [{ id: 'npc-chua-co', x: 2, y: 2 }] }),
    );
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('npc-chua-co');
  });

  it('chấp nhận NPC có file hội thoại tương ứng', async () => {
    await write(
      'maps/map-mot.json',
      mapFixture('map-mot', { npcs: [{ id: 'npc-thay-hieu-truong', x: 2, y: 2 }] }),
    );
    await write('npcs/npc-thay-hieu-truong.json', npcFixture('npc-thay-hieu-truong'));
    expect(await validateGameData(dir)).toEqual({ checked: 2, errors: [] });
  });

  it('không báo lỗi liên-map khi một file đã sai schema (tránh lỗi dây chuyền)', async () => {
    await write('maps/map-mot.json', mapFixture('map-mot', { width: 2, height: 2 }));
    const result = await validateGameData(dir);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.file === 'maps/map-mot.json')).toBe(true);
  });
});

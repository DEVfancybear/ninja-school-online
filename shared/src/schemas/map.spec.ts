import { describe, expect, it } from 'vitest';
import { GameMapSchema, NpcSchema } from './map.js';

/** Bản đồ nhỏ nhất hợp lệ: 8x8 (giới hạn MAP_MIN_TILES), có một ô tường ở giữa. */
function tinyMap(overrides: Record<string, unknown> = {}) {
  const size = 8;
  const emptyRow = () => Array.from({ length: size }, () => 0);
  const ground = Array.from({ length: size }, emptyRow);
  ground[3] = [0, 0, 0, 1, 1, 0, 0, 0];

  return {
    id: 'map-thu',
    name: 'Bản đồ thử',
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

/** Bản đồ 8x8 với lớp ground cho trước (để kiểm các trường hợp sai kích thước). */
function mapWithGround(ground: number[][], extra: Record<string, unknown> = {}) {
  return tinyMap({ ground, ...extra });
}

describe('GameMapSchema', () => {
  it('chấp nhận bản đồ tối thiểu và điền mặc định', () => {
    const parsed = GameMapSchema.parse(tinyMap());
    expect(parsed.tileSize).toBe(32);
    expect(parsed.decor).toEqual([]);
    expect(parsed.portals).toEqual([]);
    expect(parsed.npcs).toEqual([]);
  });

  it('từ chối khi số hàng của ground khác height', () => {
    const shortGround = [Array.from({ length: 8 }, () => 0)];
    const result = GameMapSchema.safeParse(mapWithGround(shortGround));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('đúng 8 hàng');
  });

  it('từ chối khi một hàng của ground sai số ô', () => {
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
    rows[2] = [0, 0, 0];
    const result = GameMapSchema.safeParse(mapWithGround(rows));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('đúng 8 ô');
  });

  it('từ chối khi ground có ô trống (-1)', () => {
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
    rows[4]![4] = -1;
    const result = GameMapSchema.safeParse(mapWithGround(rows));
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes('không được có ô trống')),
    ).toBe(true);
  });

  it('từ chối khi ô dùng loại gạch không có trong bảng', () => {
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
    rows[1]![1] = 9;
    const result = GameMapSchema.safeParse(mapWithGround(rows));
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes('không có trong bảng tiles')),
    ).toBe(true);
  });

  it('từ chối màu sai định dạng', () => {
    const result = GameMapSchema.safeParse(
      tinyMap({ tiles: [{ id: 0, name: 'cỏ', color: 'xanh lá', blocked: false }] }),
    );
    expect(result.success).toBe(false);
  });

  it('từ chối cổng nằm ngoài bản đồ', () => {
    const result = GameMapSchema.safeParse(
      tinyMap({
        portals: [{ id: 'c1', x: 6, y: 1, width: 5, height: 2, toMap: 'khac', toSpawn: 'default' }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('ngoài bản đồ'))).toBe(true);
  });

  it('chấp nhận cổng trỏ tới map khác (kiểm liên-map do data-validator lo)', () => {
    const parsed = GameMapSchema.parse(
      tinyMap({
        portals: [
          { id: 'c1', x: 6, y: 0, width: 2, height: 8, toMap: 'map-khac', toSpawn: 'default' },
        ],
      }),
    );
    expect(parsed.portals[0]?.toMap).toBe('map-khac');
  });

  it('từ chối kích thước bản đồ quá nhỏ', () => {
    expect(GameMapSchema.safeParse(tinyMap({ width: 2, height: 2 })).success).toBe(false);
  });

  it('từ chối điểm spawn nằm ngoài bản đồ', () => {
    const result = GameMapSchema.safeParse(tinyMap({ spawns: [{ id: 'default', x: 20, y: 1 }] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('ngoài bản đồ'))).toBe(true);
  });
});

describe('NpcSchema', () => {
  it('chấp nhận NPC có ít nhất một dòng hội thoại', () => {
    const parsed = NpcSchema.parse({
      id: 'npc-thay-hieu-truong',
      name: 'Thầy Hiệu Trưởng',
      color: '#e0b457',
      lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Chào mừng con.' }],
    });
    expect(parsed.lines).toHaveLength(1);
  });

  it('từ chối NPC không có dòng hội thoại nào', () => {
    const result = NpcSchema.safeParse({
      id: 'npc-thay-hieu-truong',
      name: 'Thầy Hiệu Trưởng',
      color: '#e0b457',
      lines: [],
    });
    expect(result.success).toBe(false);
  });

  it('từ chối id NPC sai quy ước đặt tên', () => {
    expect(
      NpcSchema.safeParse({
        id: 'thay-hieu-truong',
        name: 'Thầy',
        color: '#e0b457',
        lines: [{ speaker: 'Thầy', text: 'Chào.' }],
      }).success,
    ).toBe(false);
  });
});

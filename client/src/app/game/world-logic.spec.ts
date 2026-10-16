import { type MapSnapshot } from '@ninja/shared';
import { describe, expect, it } from 'vitest';
import { type WorldEntity } from '../net/world-types';
import {
  buildTileLookup,
  clampToMap,
  entityAtPoint,
  entityStyle,
  facingForVector,
  facingVector,
  interpolatePosition,
  isBlockedTile,
  parseHexColor,
  tileAt,
  tileCenterWorld,
  tileIndexAt,
  worldToTile,
} from './world-logic';

const MAP: MapSnapshot = {
  id: 'test',
  name: 'Bản đồ thử',
  width: 3,
  height: 2,
  tileSize: 32,
  tiles: [
    { id: 1, color: '#3b6b3f', blocked: false },
    { id: 2, color: '#556655', blocked: true },
  ],
  ground: [
    [1, -1, 2],
    [1, 1, 1],
  ],
  decor: [
    [-1, 2, -1],
    [-1, -1, -1],
  ],
};

function entity(overrides: Partial<WorldEntity> & { id: string }): WorldEntity {
  return {
    kind: 'player',
    name: overrides.id,
    color: '#ff8844',
    x: 0,
    y: 0,
    facing: 'none',
    ...overrides,
  };
}

describe('tra ô gạch', () => {
  it('trả về -1 khi ngoài biên hoặc ô trống', () => {
    expect(tileIndexAt(MAP.ground, 0, 0)).toBe(1);
    expect(tileIndexAt(MAP.ground, 1, 0)).toBe(-1);
    expect(tileIndexAt(MAP.ground, -1, 0)).toBe(-1);
    expect(tileIndexAt(MAP.ground, 0, -1)).toBe(-1);
    expect(tileIndexAt(MAP.ground, 3, 0)).toBe(-1);
    expect(tileIndexAt(MAP.ground, 0, 9)).toBe(-1);
    expect(tileIndexAt([], 0, 0)).toBe(-1);
  });

  it('tra được gạch theo id, id lạ thì trả về null', () => {
    const lookup = buildTileLookup(MAP.tiles);
    expect(tileAt(MAP.ground, lookup, 0, 0)?.color).toBe('#3b6b3f');
    expect(tileAt(MAP.ground, lookup, 1, 0)).toBeNull();
    expect(tileAt([[7]], lookup, 0, 0)).toBeNull();
  });

  it('ô chặn đi là ô có lớp nền hoặc lớp trang trí chặn', () => {
    expect(isBlockedTile(MAP, 0, 0)).toBe(false);
    expect(isBlockedTile(MAP, 1, 1)).toBe(false);
    expect(isBlockedTile(MAP, 2, 0)).toBe(true);
    // (1,0) chỉ có trang trí chặn.
    expect(isBlockedTile(MAP, 1, 0)).toBe(true);
  });
});

describe('đổi toạ độ', () => {
  it('đổi toạ độ thế giới sang ô, ngoài biên trả về null', () => {
    expect(worldToTile(MAP, { x: 0, y: 0 })).toEqual({ col: 0, row: 0 });
    expect(worldToTile(MAP, { x: 31, y: 31 })).toEqual({ col: 0, row: 0 });
    expect(worldToTile(MAP, { x: 32, y: 33 })).toEqual({ col: 1, row: 1 });
    expect(worldToTile(MAP, { x: -1, y: 0 })).toBeNull();
    expect(worldToTile(MAP, { x: 96, y: 0 })).toBeNull();
    expect(worldToTile(MAP, { x: 0, y: 64 })).toBeNull();
  });

  it('lấy tâm ô theo toạ độ thế giới', () => {
    expect(tileCenterWorld(MAP, 0, 0)).toEqual({ x: 16, y: 16 });
    expect(tileCenterWorld(MAP, 2, 1)).toEqual({ x: 80, y: 48 });
  });

  it('giữ điểm trong biên bản đồ', () => {
    expect(clampToMap(MAP, { x: -5, y: 200 })).toEqual({ x: 0, y: 64 });
    expect(clampToMap(MAP, { x: 200, y: -5 })).toEqual({ x: 96, y: 0 });
    expect(clampToMap(MAP, { x: 40, y: 40 })).toEqual({ x: 40, y: 40 });
  });
});

describe('tính hướng', () => {
  it('chia 8 hướng đều nhau', () => {
    expect(facingForVector({ x: 1, y: 0 })).toBe('e');
    expect(facingForVector({ x: -1, y: 0 })).toBe('w');
    expect(facingForVector({ x: 0, y: 1 })).toBe('s');
    expect(facingForVector({ x: 0, y: -1 })).toBe('n');
    expect(facingForVector({ x: 1, y: 1 })).toBe('se');
    expect(facingForVector({ x: -1, y: 1 })).toBe('sw');
    expect(facingForVector({ x: 1, y: -1 })).toBe('ne');
    expect(facingForVector({ x: -1, y: -1 })).toBe('nw');
  });

  it('véc-tơ đã chuẩn hoá vẫn ra hướng đúng', () => {
    const diagonal = 1 / Math.SQRT2;
    expect(facingForVector({ x: diagonal, y: -diagonal })).toBe('ne');
    expect(facingForVector({ x: -diagonal, y: diagonal })).toBe('sw');
  });

  it('gần trục thì lấy hướng trục, không lấy hướng chéo', () => {
    expect(facingForVector({ x: 1, y: 0.2 })).toBe('e');
    expect(facingForVector({ x: 0.2, y: 1 })).toBe('s');
    expect(facingForVector({ x: -0.2, y: -1 })).toBe('n');
  });

  it('đứng yên thì là none', () => {
    expect(facingForVector({ x: 0, y: 0 })).toBe('none');
    expect(facingVector('none')).toEqual({ x: 0, y: 0 });
  });

  it('véc-tơ của mỗi hướng dài bằng 1', () => {
    for (const facing of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const) {
      const vector = facingVector(facing);
      expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(1, 6);
    }
    expect(facingVector('n')).toEqual({ x: 0, y: -1 });
    expect(facingVector('w')).toEqual({ x: -1, y: 0 });
  });
});

describe('nội suy vị trí', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 132, y: 84 };

  it('đi từ đầu tới cuối theo tỉ lệ thời gian', () => {
    expect(interpolatePosition(from, to, 0, 100)).toEqual(from);
    expect(interpolatePosition(from, to, 50, 100)).toEqual({ x: 116, y: 92 });
    expect(interpolatePosition(from, to, 100, 100)).toEqual(to);
  });

  it('giữ nguyên vị trí đích khi quá thời gian hoặc trước khi bắt đầu', () => {
    expect(interpolatePosition(from, to, 250, 100)).toEqual(to);
    expect(interpolatePosition(from, to, -30, 100)).toEqual(from);
  });

  it('nhịp tick bằng 0 thì nhảy thẳng tới đích', () => {
    expect(interpolatePosition(from, to, 10, 0)).toEqual(to);
  });
});

describe('vẽ thực thể', () => {
  it('NPC khác cỡ người chơi', () => {
    expect(entityStyle('npc')).not.toEqual(entityStyle('player'));
    expect(entityStyle('npc').height).toBeGreaterThan(entityStyle('player').height);
  });

  it('đổi màu hex sang số nguyên, dữ liệu sai thì dùng màu dự phòng', () => {
    expect(parseHexColor('#3b6b3f')).toBe(0x3b6b3f);
    expect(parseHexColor('3b6b3f')).toBe(0x3b6b3f);
    expect(parseHexColor('  #FFFFFF  ')).toBe(0xffffff);
    expect(parseHexColor('không phải màu')).toBe(0x334155);
    expect(parseHexColor('#12345g', 0x111111)).toBe(0x111111);
  });
});

describe('tìm thực thể theo điểm bấm', () => {
  it('bấm trúng thì trả về thực thể, bấm ra ngoài thì không', () => {
    const npc = entity({ id: 'npc1', kind: 'npc', x: 100, y: 100 });

    expect(entityAtPoint([npc], { x: 100, y: 100 })?.id).toBe('npc1');
    expect(entityAtPoint([npc], { x: 112, y: 110 })?.id).toBe('npc1');
    expect(entityAtPoint([npc], { x: 140, y: 100 })).toBeNull();
  });

  it('ưu tiên NPC khi hai thực thể chồng nhau', () => {
    const npc = entity({ id: 'npc1', kind: 'npc', x: 100, y: 100 });
    const player = entity({ id: 'p1', x: 100, y: 100 });

    expect(entityAtPoint([player, npc], { x: 100, y: 100 })?.id).toBe('npc1');
  });

  it('không có NPC nào thì trả về người chơi gần nhất', () => {
    const near = entity({ id: 'p1', x: 100, y: 100 });
    const far = entity({ id: 'p2', x: 112, y: 100 });

    expect(entityAtPoint([far, near], { x: 110, y: 100 })?.id).toBe('p2');
  });

  it('danh sách rỗng thì trả về null', () => {
    expect(entityAtPoint([], { x: 0, y: 0 })).toBeNull();
  });

  it('bấm trúng quái thì trả về con quái (để vào trận)', () => {
    const monster = entity({
      id: 'mob:1',
      kind: 'monster',
      name: 'Bù Nhìn Tập Luyện',
      x: 100,
      y: 100,
      hp: 30,
      maxHp: 30,
      shape: 'scarecrow',
    });

    expect(entityAtPoint([monster], { x: 100, y: 100 })?.id).toBe('mob:1');
    expect(entityAtPoint([monster], { x: 120, y: 118 })?.kind).toBe('monster');
    expect(entityAtPoint([monster], { x: 160, y: 100 })).toBeNull();
  });

  it('quái có vùng bấm riêng trong bảng kích thước thực thể', () => {
    expect(entityStyle('monster')).toEqual({ width: 34, height: 30, radius: 9 });
  });
});

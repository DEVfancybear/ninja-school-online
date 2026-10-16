import { TICK_RATE_MS, type EntityKind, type MapSnapshot } from '@ninja/shared';
import type { Facing, WorldEntity } from '../net/world-types';

/**
 * Toàn bộ phần "tính toán" của màn chơi, tách khỏi Phaser để kiểm thử được mà không cần
 * canvas: tra ô gạch, toạ độ thế giới ↔ ô, tính hướng, nội suy chuyển động, tìm thực thể
 * theo điểm bấm. `WorldScene` chỉ còn việc vẽ ra màn hình.
 */

/** Một điểm trong hệ toạ độ thế giới (pixel), gốc ở góc trên bên trái bản đồ. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface TilePoint {
  readonly col: number;
  readonly row: number;
}

/** Lớp gạch của bản đồ: mảng hai chiều `[row][col]`, `-1` là ô trống. */
export type TileLayer = readonly (readonly number[])[];
export type MapTile = MapSnapshot['tiles'][number];

/** Cùng một `tan(22.5°)` để chia 360° thành 8 hướng đều nhau. */
const OCTANT_TANGENT = Math.tan(Math.PI / 8);

/** Kích thước vẽ của từng loại thực thể (pixel) và bán kính bo góc. */
export interface EntityStyle {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

export const ENTITY_STYLES: Record<EntityKind, EntityStyle> = {
  // Kích thước này vừa dùng để vẽ nhân vật (xem `tile-art.ts`) vừa là vùng bấm, nên rộng rãi một
  // chút cho dễ chạm trên điện thoại; NPC vẫn cao hơn người chơi.
  player: { width: 26, height: 34, radius: 6 },
  npc: { width: 30, height: 44, radius: 8 },
  // Quái thấp và bè hơn người để nhìn là biết ngay đâu là thứ đánh được.
  monster: { width: 34, height: 30, radius: 9 },
};

/** Vùng bấm rộng hơn hình vẽ một chút cho dễ chạm trên điện thoại. */
export const ENTITY_HIT_SLACK_PX = 8;

/** Tra nhanh `id` gạch → thông tin gạch (màu, chặn đi). */
export function buildTileLookup(tiles: readonly MapTile[]): ReadonlyMap<number, MapTile> {
  return new Map(tiles.map((tile) => [tile.id, tile]));
}

/**
 * Chỉ số gạch tại một ô, `-1` khi ngoài biên hoặc ô trống.
 * Biên lấy theo chính mảng lớp gạch: dữ liệu thiếu hàng/cột cũng không làm vỡ vòng vẽ.
 */
export function tileIndexAt(layer: TileLayer, col: number, row: number): number {
  if (col < 0 || row < 0) {
    return -1;
  }
  const value = layer[row]?.[col];
  return value === undefined ? -1 : value;
}

export function tileAt(
  layer: TileLayer,
  lookup: ReadonlyMap<number, MapTile>,
  col: number,
  row: number,
): MapTile | null {
  const index = tileIndexAt(layer, col, row);
  return index < 0 ? null : (lookup.get(index) ?? null);
}

/** Ô có chặn đi không: lớp nền **hoặc** lớp trang trí chặn là chặn. */
export function isBlockedTile(map: MapSnapshot, col: number, row: number): boolean {
  const lookup = buildTileLookup(map.tiles);
  return (
    (tileAt(map.ground, lookup, col, row)?.blocked ?? false) ||
    (tileAt(map.decor, lookup, col, row)?.blocked ?? false)
  );
}

/** Đổi toạ độ thế giới sang ô gạch; `null` khi điểm nằm ngoài bản đồ. */
export function worldToTile(map: MapSnapshot, point: Point): TilePoint | null {
  if (point.x < 0 || point.y < 0) {
    return null;
  }
  const col = Math.floor(point.x / map.tileSize);
  const row = Math.floor(point.y / map.tileSize);
  return col >= map.width || row >= map.height ? null : { col, row };
}

/** Tâm ô gạch theo toạ độ thế giới — điểm client gửi trong `C2S_MOVE`. */
export function tileCenterWorld(map: MapSnapshot, col: number, row: number): Point {
  const size = map.tileSize;
  return { x: col * size + size / 2, y: row * size + size / 2 };
}

/** Giữ một điểm trong biên bản đồ (dùng cho đích di chuyển do bấm chuột). */
export function clampToMap(map: MapSnapshot, point: Point): Point {
  const maxX = map.width * map.tileSize;
  const maxY = map.height * map.tileSize;
  return {
    x: Math.min(Math.max(point.x, 0), maxX),
    y: Math.min(Math.max(point.y, 0), maxY),
  };
}

/** Hướng 8 chiều từ một véc-tơ bất kỳ; `none` khi véc-tơ gần như bằng 0. */
export function facingForVector(vector: Point): Facing {
  const { x, y } = vector;
  if (x === 0 && y === 0) {
    return 'none';
  }
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ay <= ax * OCTANT_TANGENT) {
    return x > 0 ? 'e' : 'w';
  }
  if (ax <= ay * OCTANT_TANGENT) {
    return y > 0 ? 's' : 'n';
  }
  if (y > 0) {
    return x > 0 ? 'se' : 'sw';
  }
  return x > 0 ? 'ne' : 'nw';
}

/** Véc-tơ đơn vị của một hướng, dùng để vẽ mũi nhọn chỉ hướng. */
export function facingVector(facing: Facing): Point {
  switch (facing) {
    case 'n':
      return { x: 0, y: -1 };
    case 'ne':
      return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    case 'e':
      return { x: 1, y: 0 };
    case 'se':
      return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    case 's':
      return { x: 0, y: 1 };
    case 'sw':
      return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    case 'w':
      return { x: -1, y: 0 };
    case 'nw':
      return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Nội suy vị trí giữa hai gói `S2C_ENTITY_MOVE`: server gửi 10 lần/giây còn client vẽ 60 fps,
 * nên nếu nhảy thẳng theo gói thì hình sẽ giật.
 */
export function interpolatePosition(
  from: Point,
  to: Point,
  elapsedMs: number,
  durationMs: number = TICK_RATE_MS,
): Point {
  if (durationMs <= 0) {
    return { x: to.x, y: to.y };
  }
  const progress = Math.min(Math.max(elapsedMs / durationMs, 0), 1);
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

export function entityStyle(kind: EntityKind): EntityStyle {
  return ENTITY_STYLES[kind];
}

/**
 * `#rrggbb` → số nguyên màu của Phaser. Màu gạch trong `MapSnapshot` chỉ được kiểm là
 * `z.string()` nên có thể sai: khi đó dùng màu dự phòng thay vì vẽ ra màu đen khó hiểu.
 */
export function parseHexColor(hex: string, fallback = 0x334155): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return match ? Number.parseInt(match[1], 16) : fallback;
}

/**
 * Thực thể nằm dưới một điểm bấm. Ưu tiên NPC: NPC là thứ người chơi muốn bấm để nói chuyện,
 * còn bấm vào người chơi khác chỉ là "đi tới chỗ đó".
 */
export function entityAtPoint(
  entities: readonly WorldEntity[],
  point: Point,
  slackPx: number = ENTITY_HIT_SLACK_PX,
): WorldEntity | null {
  // Quái đứng trước: bấm vào chỗ có quái là để vào trận, không phải để nói chuyện hay đi bộ.
  const preferred: readonly EntityKind[] = ['monster', 'npc', 'player'];
  for (const kind of preferred) {
    let best: WorldEntity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entity of entities) {
      if (entity.kind !== kind) {
        continue;
      }
      const style = entityStyle(entity.kind);
      const dx = Math.abs(point.x - entity.x);
      const dy = Math.abs(point.y - entity.y);
      if (dx > style.width / 2 + slackPx || dy > style.height / 2 + slackPx) {
        continue;
      }
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = entity;
        bestDistance = distance;
      }
    }
    if (best) {
      return best;
    }
  }
  return null;
}

import type { GameMap, MapSnapshot, MapTile } from '@ninja/shared';

/**
 * Cổng dịch chuyển trong một bản đồ. `shared` chỉ xuất schema `MapPortalSchema` chứ không xuất
 * kiểu tương ứng, nên server tự suy ra từ `GameMap` (không sửa `shared`).
 */
export type MapPortal = GameMap['portals'][number];

/** Vị trí trong thế giới, tính bằng pixel. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/** Id điểm spawn mặc định theo quy ước dữ liệu (`game-data/maps/*.json`). */
export const DEFAULT_SPAWN_ID = 'default';

/** Ô decor tại (tx, ty); lớp decor có thể ngắn hơn bản đồ nên thiếu thì coi như ô trống. */
function layerTileAt(layer: readonly (readonly number[])[], tx: number, ty: number): number {
  const row: readonly number[] | undefined = layer[ty];
  const value: number | undefined = row === undefined ? undefined : row[tx];
  return value === undefined ? -1 : value;
}

/**
 * Một bản đồ đã nạp, kèm tiện ích đổi qua lại giữa toạ độ pixel và ô gạch.
 *
 * Quy ước toạ độ (chốt ở M2, client vẽ theo đúng quy ước này):
 * - Gốc (0, 0) là góc trên-trái bản đồ, trục y hướng xuống.
 * - Ô (tx, ty) phủ vùng pixel nửa mở `[tx*tileSize, (tx+1)*tileSize) x [ty*tileSize, (ty+1)*tileSize)`.
 * - Toạ độ thực thể là điểm giữa thân nhân vật, không phải góc ô.
 */
export class MapInstance {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;

  private readonly tileById: ReadonlyMap<number, MapTile>;
  /** Ô bị chặn (theo lớp ground hoặc decor): `blockedByTile[ty][tx]`. */
  private readonly blockedByTile: readonly (readonly boolean[])[];
  private readonly spawns: ReadonlyMap<string, Position>;

  constructor(readonly data: GameMap) {
    this.id = data.id;
    this.name = data.name;
    this.width = data.width;
    this.height = data.height;
    this.tileSize = data.tileSize;
    this.pixelWidth = data.width * data.tileSize;
    this.pixelHeight = data.height * data.tileSize;
    this.tileById = new Map(data.tiles.map((tile) => [tile.id, tile]));

    const blocked: boolean[][] = [];
    for (let ty = 0; ty < this.height; ty += 1) {
      const row: boolean[] = [];
      for (let tx = 0; tx < this.width; tx += 1) {
        const ground = layerTileAt(data.ground, tx, ty);
        const decor = layerTileAt(data.decor, tx, ty);
        row.push(this.isBlockedTileId(ground) || this.isBlockedTileId(decor));
      }
      blocked.push(row);
    }
    this.blockedByTile = blocked;

    this.spawns = new Map(
      data.spawns.map((spawn) => [spawn.id, this.tileCenter(spawn.x, spawn.y)]),
    );
  }

  /** Điểm giữa của một ô gạch (pixel) — dùng cho điểm spawn và vị trí NPC đặt sẵn. */
  tileCenter(tx: number, ty: number): Position {
    return { x: tx * this.tileSize + this.tileSize / 2, y: ty * this.tileSize + this.tileSize / 2 };
  }

  /** Ô chứa một điểm pixel. */
  tileAt(x: number, y: number): { tx: number; ty: number } {
    return { tx: Math.floor(x / this.tileSize), ty: Math.floor(y / this.tileSize) };
  }

  /** Điểm có nằm trong bản đồ không (biên trên/trái tính là trong, biên dưới/phải là ngoài). */
  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.pixelWidth && y < this.pixelHeight;
  }

  /** Ô (tx, ty) có bị chặn không; ngoài bản đồ coi như bị chặn. */
  isBlockedTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
      return true;
    }
    const row = this.blockedByTile[ty];
    return row === undefined ? true : row[tx] === true;
  }

  /** Điểm pixel có nằm trong ô bị chặn không. */
  isBlockedAt(x: number, y: number): boolean {
    const { tx, ty } = this.tileAt(x, y);
    return this.isBlockedTile(tx, ty);
  }

  /** Vị trí của điểm spawn theo id; không có thì trả `undefined`. */
  spawnPosition(spawnId: string): Position | undefined {
    return this.spawns.get(spawnId);
  }

  /** Điểm spawn mặc định: `default` nếu có, không thì điểm spawn đầu tiên. */
  defaultSpawn(): Position | undefined {
    const fallback = [...this.spawns.values()][0];
    return this.spawns.get(DEFAULT_SPAWN_ID) ?? fallback;
  }

  /** Cổng dịch chuyển có vùng chứa điểm (x, y), nếu có. */
  portalAt(x: number, y: number): MapPortal | undefined {
    return this.data.portals.find((portal) => {
      const left = portal.x * this.tileSize;
      const top = portal.y * this.tileSize;
      return (
        x >= left &&
        x < left + portal.width * this.tileSize &&
        y >= top &&
        y < top + portal.height * this.tileSize
      );
    });
  }

  /** Bản đồ gửi cho client: chỉ những trường client cần để vẽ. */
  toSnapshot(): MapSnapshot {
    return {
      id: this.id,
      name: this.name,
      width: this.width,
      height: this.height,
      tileSize: this.tileSize,
      tiles: this.data.tiles.map((tile) => ({
        id: tile.id,
        color: tile.color,
        blocked: tile.blocked,
      })),
      ground: this.data.ground.map((row) => [...row]),
      decor: this.data.decor.map((row) => [...row]),
    };
  }

  private isBlockedTileId(tileId: number): boolean {
    if (tileId < 0) {
      return false;
    }
    return this.tileById.get(tileId)?.blocked ?? false;
  }
}

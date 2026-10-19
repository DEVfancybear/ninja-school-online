import { z } from 'zod';
import { QUEST_VIEW_STATES } from '../constants/quest.js';
import {
  CHAT_MAX_LENGTH,
  DEFAULT_TILE_SIZE,
  MAP_MAX_TILES,
  MAP_MIN_TILES,
} from '../constants/world.js';

/** Một loại gạch trong bảng màu của bản đồ. Chưa có tài nguyên hình nên mỗi loại là một màu. */
export const MapTileSchema = z.object({
  id: z.number().int().min(0),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'màu phải ở dạng #rrggbb'),
  blocked: z.boolean().default(false),
});

/** Lớp gạch: mỗi phần tử là chỉ số trong bảng `tiles`; `-1` nghĩa là ô trống (trong suốt). */
const TileLayerSchema = z.array(z.array(z.number().int().min(-1)));

export const MapSpawnSchema = z.object({
  id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const MapPortalSchema = z.object({
  id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  toMap: z.string().min(1),
  toSpawn: z.string().min(1),
});

/** NPC đặt sẵn trên bản đồ; hội thoại nằm trong game-data/npcs/. */
export const MapNpcPlacementSchema = z.object({
  id: z.string().regex(/^npc-[a-z0-9-]+$/, 'id NPC phải có dạng npc-ten-npc'),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

/**
 * Quái đặt sẵn trên bản đồ; chỉ số nằm trong `game-data/monsters/`. Nhiều chỗ đặt cùng một loại quái
 * được: mỗi chỗ là một **con** riêng, có máu và thời gian hồi sinh riêng.
 */
export const MapMonsterPlacementSchema = z.object({
  id: z.string().regex(/^mob-[a-z0-9-]+$/, 'id quái phải có dạng mob-ten-quai'),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

/** Một bản đồ trong game-data/maps/*.json. */
export const GameMapSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'id map chỉ gồm chữ thường, chữ số và dấu gạch ngang'),
    name: z.string().min(1),
    width: z.number().int().min(MAP_MIN_TILES).max(MAP_MAX_TILES),
    height: z.number().int().min(MAP_MIN_TILES).max(MAP_MAX_TILES),
    tileSize: z.number().int().min(8).max(128).default(DEFAULT_TILE_SIZE),
    tiles: z.array(MapTileSchema).min(1),
    ground: TileLayerSchema,
    decor: TileLayerSchema.default([]),
    spawns: z.array(MapSpawnSchema).min(1),
    portals: z.array(MapPortalSchema).default([]),
    npcs: z.array(MapNpcPlacementSchema).default([]),
    monsters: z.array(MapMonsterPlacementSchema).default([]),
  })
  .superRefine((map, ctx) => {
    if (map.ground.length !== map.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['ground'],
        message: `lớp ground phải có đúng ${map.height} hàng, đang có ${map.ground.length}`,
      });
    }
    map.ground.forEach((row, index) => {
      if (row.length !== map.width) {
        ctx.addIssue({
          code: 'custom',
          path: ['ground', index],
          message: `hàng ${index} phải có đúng ${map.width} ô, đang có ${row.length}`,
        });
      }
    });
    for (const [index, row] of map.decor.entries()) {
      if (row.length !== map.width) {
        ctx.addIssue({
          code: 'custom',
          path: ['decor', index],
          message: `hàng ${index} của decor phải có đúng ${map.width} ô, đang có ${row.length}`,
        });
      }
    }

    const tileIds = new Set(map.tiles.map((tile) => tile.id));
    const checkTiles = (layer: number[][], path: string): void => {
      layer.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          if (value !== -1 && !tileIds.has(value)) {
            ctx.addIssue({
              code: 'custom',
              path: [path, rowIndex, columnIndex],
              message: `ô này dùng loại gạch ${value} không có trong bảng tiles`,
            });
          }
        });
      });
    };
    checkTiles(map.ground, 'ground');
    checkTiles(map.decor, 'decor');

    for (const [index, spawn] of map.spawns.entries()) {
      if (spawn.x >= map.width || spawn.y >= map.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawns', index],
          message: 'điểm spawn nằm ngoài bản đồ',
        });
      }
    }
    for (const [index, portal] of map.portals.entries()) {
      // `toSpawn` trỏ tới điểm spawn của **map đích**, không phải map này, nên không kiểm ở đây;
      // công cụ kiểm tra dữ liệu (tools/data-validator) kiểm liên-map vì nó có toàn bộ bản đồ.
      if (portal.x + portal.width > map.width || portal.y + portal.height > map.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['portals', index],
          message: 'vùng cổng nằm ngoài bản đồ',
        });
      }
    }
    for (const [index, npc] of map.npcs.entries()) {
      if (npc.x >= map.width || npc.y >= map.height) {
        ctx.addIssue({ code: 'custom', path: ['npcs', index], message: 'NPC nằm ngoài bản đồ' });
      }
    }
    for (const [index, monster] of map.monsters.entries()) {
      if (monster.x >= map.width || monster.y >= map.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['monsters', index],
          message: 'quái đứng ngoài bản đồ',
        });
      }
    }

    // Lớp ground phải phủ kín bản đồ: chỉ số -1 ở ground nghĩa là lỗ hổng không vẽ được.
    const hasHole = map.ground.some((row) => row.some((value) => value === -1));
    if (hasHole) {
      ctx.addIssue({
        code: 'custom',
        path: ['ground'],
        message: 'lớp ground không được có ô trống',
      });
    }
  });

export type MapTile = z.infer<typeof MapTileSchema>;
export type GameMap = z.infer<typeof GameMapSchema>;

/** Một dòng hội thoại của NPC. */
export const NpcLineSchema = z.object({
  speaker: z.string().min(1),
  text: z.string().min(1).max(CHAT_MAX_LENGTH),
});

/** Điều kiện để một nhánh hội thoại được chọn; mọi điều kiện ghi ra đều phải đúng. */
export const NpcDialogConditionSchema = z.object({
  /** Nhánh chỉ dùng khi người chơi đang ở trạng thái này của nhiệm vụ. */
  questId: z
    .string()
    .regex(/^quest-[a-z0-9-]+$/)
    .optional(),
  state: z.enum(QUEST_VIEW_STATES).optional(),
  levelAtLeast: z.number().int().min(1).optional(),
});

/** Một lựa chọn người chơi bấm trong hội thoại; `next` bỏ trống là kết thúc hội thoại. */
export const NpcDialogOptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id lựa chọn chỉ gồm chữ thường, chữ số và gạch ngang'),
  text: z.string().min(1).max(CHAT_MAX_LENGTH),
  next: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'id nhánh chỉ gồm chữ thường, chữ số và gạch ngang')
    .optional(),
});

/**
 * Một nhánh hội thoại. Khi bắt đầu nói chuyện, server chọn **nhánh đầu tiên có `when` và khớp**
 * theo thứ tự trong file — thứ tự khai báo là thứ tự ưu tiên; không nhánh nào khớp thì dùng
 * `lines` mặc định. Nhánh **không có `when`** chỉ tới được bằng lựa chọn `next` ở nhánh trước,
 * nên dùng nó cho đoạn nói tiếp trong cùng một cuộc hội thoại.
 */
export const NpcDialogNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id nhánh chỉ gồm chữ thường, chữ số và gạch ngang'),
  when: NpcDialogConditionSchema.optional(),
  lines: z.array(NpcLineSchema).min(1),
  options: z.array(NpcDialogOptionSchema).default([]),
});

/** Một NPC trong game-data/npcs/*.json. */
export const NpcSchema = z.object({
  id: z.string().regex(/^npc-[a-z0-9-]+$/),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'màu phải ở dạng #rrggbb'),
  /**
   * Hội thoại mặc định: dùng khi NPC không có nhánh nào trong `dialog` khớp trạng thái người chơi.
   */
  lines: z.array(NpcLineSchema).min(1),
  /**
   * Cây hội thoại theo trạng thái nhiệm vụ và cấp. Rỗng là NPC chỉ có một đoạn nói cố định.
   * `checkGameData` kiểm `next` trỏ tới nhánh có thật của **cùng NPC** và `questId` có thật.
   */
  dialog: z.array(NpcDialogNodeSchema).default([]),
  /**
   * Vật phẩm NPC này bán, theo `itemId` trong `game-data/items/`. Rỗng là NPC thường, bấm vào chỉ
   * có hội thoại. `checkGameData` kiểm từng món phải có thật và có giá.
   */
  shop: z.array(z.string().regex(/^item-[a-z0-9-]+$/)).default([]),
});

export type NpcLine = z.infer<typeof NpcLineSchema>;
export type NpcDialogNode = z.infer<typeof NpcDialogNodeSchema>;
export type NpcDialogOption = z.infer<typeof NpcDialogOptionSchema>;
export type Npc = z.infer<typeof NpcSchema>;

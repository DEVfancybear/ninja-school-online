import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameMapSchema, NpcSchema, type GameMap, type Npc } from '@ninja/shared';
import type { ZodType } from 'zod';

/**
 * Thư mục game-data ở gốc repo. Đường dẫn này đúng cho cả khi chạy từ `src/` (tsx) và `dist/`
 * sau khi build, vì hai file cách gốc repo đúng ba cấp.
 */
export const DEFAULT_GAME_DATA_DIR = fileURLToPath(new URL('../../../game-data', import.meta.url));

/** Một lỗi dữ liệu: file nào, trường nào, sai thế nào. */
export interface GameDataIssue {
  /** Đường dẫn tương đối trong game-data, ví dụ `maps/lang-khoi-nguon.json`. */
  readonly file: string;
  /** Đường dẫn trường bên trong file, ví dụ `ground.3`. */
  readonly path: string;
  readonly message: string;
}

/** Dữ liệu nội dung đã nạp và kiểm: map theo id + NPC theo id. */
export interface GameData {
  readonly maps: ReadonlyMap<string, GameMap>;
  readonly npcs: ReadonlyMap<string, Npc>;
}

/** Dữ liệu nội dung sai: server **không** được khởi động khi gặp lỗi này. */
export class GameDataError extends Error {
  readonly issues: readonly GameDataIssue[];

  constructor(issues: readonly GameDataIssue[]) {
    super(
      ['game-data không hợp lệ nên server không khởi động:', ...issues.map(formatIssue)].join('\n'),
    );
    this.name = 'GameDataError';
    this.issues = issues;
  }
}

function formatIssue(issue: GameDataIssue): string {
  const where = issue.path ? `${issue.file} [${issue.path}]` : issue.file;
  return `  ${where}: ${issue.message}`;
}

interface CollectionResult {
  readonly values: unknown[];
  readonly issues: GameDataIssue[];
}

/** Đọc và kiểm mọi file JSON trong một thư mục con của game-data. */
async function readCollection(
  gameDataDir: string,
  sub: string,
  schema: ZodType<unknown>,
): Promise<CollectionResult> {
  const fullDir = join(gameDataDir, sub);
  let names: string[];
  try {
    names = await readdir(fullDir);
  } catch (error) {
    return {
      values: [],
      issues: [
        {
          file: `${sub}/`,
          path: '',
          message: `không đọc được thư mục ${fullDir}: ${(error as Error).message}`,
        },
      ],
    };
  }

  const values: unknown[] = [];
  const issues: GameDataIssue[] = [];

  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const file = `${sub}/${name}`;
    const raw = (await readFile(join(fullDir, name), 'utf8')).replace(/^\uFEFF/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      issues.push({ file, path: '', message: `JSON không hợp lệ: ${(error as Error).message}` });
      continue;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({ file, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    values.push(result.data);
  }

  return { values, issues };
}

/** Gom giá trị theo `id`; hai file cùng id là lỗi vì bản đồ/NPC sẽ ghi đè nhau âm thầm. */
function indexById<T extends { id: string }>(
  values: readonly T[],
  sub: string,
  kind: string,
  issues: GameDataIssue[],
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const value of values) {
    if (byId.has(value.id)) {
      issues.push({
        file: `${sub}/`,
        path: 'id',
        message: `${kind} "${value.id}" bị khai báo ở nhiều file`,
      });
      continue;
    }
    byId.set(value.id, value);
  }
  return byId;
}

/**
 * Kiểm tra liên-map: mỗi cổng phải dẫn tới bản đồ có thật, và điểm spawn đích phải có ở bản đồ đó.
 * Cần thấy toàn bộ bản đồ cùng lúc nên không kiểm được trong schema của từng file.
 */
function checkPortals(maps: ReadonlyMap<string, GameMap>): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  for (const map of maps.values()) {
    const file = `maps/${map.id}.json`;
    for (const portal of map.portals) {
      const target = maps.get(portal.toMap);
      if (!target) {
        issues.push({
          file,
          path: `portals.${portal.id}.toMap`,
          message: `cổng dẫn tới bản đồ "${portal.toMap}" không tồn tại`,
        });
        continue;
      }
      if (!target.spawns.some((spawn) => spawn.id === portal.toSpawn)) {
        issues.push({
          file,
          path: `portals.${portal.id}.toSpawn`,
          message: `bản đồ "${target.id}" không có điểm spawn "${portal.toSpawn}"`,
        });
      }
    }
  }
  return issues;
}

/** NPC đặt trên bản đồ phải có file hội thoại tương ứng trong `game-data/npcs/`. */
function checkNpcPlacements(
  maps: ReadonlyMap<string, GameMap>,
  npcs: ReadonlyMap<string, Npc>,
): GameDataIssue[] {
  const issues: GameDataIssue[] = [];
  for (const map of maps.values()) {
    for (const placement of map.npcs) {
      if (!npcs.has(placement.id)) {
        issues.push({
          file: `maps/${map.id}.json`,
          path: `npcs.${placement.id}`,
          message: `chưa có file hội thoại cho NPC "${placement.id}" trong game-data/npcs/`,
        });
      }
    }
  }
  return issues;
}

/**
 * Nạp `game-data/maps/*.json` và `game-data/npcs/*.json` rồi kiểm bằng schema của `@ninja/shared`.
 *
 * Bộ quy tắc giống hệt `tools/data-validator` (schema từng file + kiểm liên-map), thêm hai kiểm
 * riêng của server: thư mục phải đọc được và id không được trùng giữa các file. Mọi lỗi được gom
 * lại rồi ném một `GameDataError` kèm danh sách file + trường sai.
 */
export async function loadGameData(gameDataDir: string = DEFAULT_GAME_DATA_DIR): Promise<GameData> {
  const [mapsResult, npcsResult] = await Promise.all([
    readCollection(gameDataDir, 'maps', GameMapSchema as ZodType<unknown>),
    readCollection(gameDataDir, 'npcs', NpcSchema as ZodType<unknown>),
  ]);

  const issues: GameDataIssue[] = [...mapsResult.issues, ...npcsResult.issues];
  const maps = indexById(mapsResult.values as GameMap[], 'maps', 'bản đồ', issues);
  const npcs = indexById(npcsResult.values as Npc[], 'npcs', 'NPC', issues);

  if (maps.size === 0 && issues.length === 0) {
    issues.push({
      file: 'maps/',
      path: '',
      message: 'không có bản đồ nào trong game-data/maps/',
    });
  }

  // Chỉ kiểm liên-map khi từng file đã hợp lệ, tránh báo lỗi dây chuyền khó hiểu.
  if (issues.length === 0) {
    issues.push(...checkPortals(maps), ...checkNpcPlacements(maps, npcs));
  }

  if (issues.length > 0) {
    throw new GameDataError(issues);
  }

  return { maps, npcs };
}

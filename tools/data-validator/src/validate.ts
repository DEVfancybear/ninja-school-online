import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GameMapSchema,
  ItemSchema,
  NpcSchema,
  SkillSchema,
  type GameMap,
  type Item,
  type Npc,
  type Skill,
} from '@ninja/shared';
import type { ZodType } from 'zod';

export interface ValidationError {
  file: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  checked: number;
  errors: ValidationError[];
}

/** Một bộ sưu tập dữ liệu: thư mục con của game-data và schema tương ứng. */
interface Collection {
  dir: string;
  schema: ZodType<unknown>;
}

const COLLECTIONS: Collection[] = [
  { dir: 'skills', schema: SkillSchema as ZodType<unknown> },
  { dir: 'items', schema: ItemSchema as ZodType<unknown> },
  { dir: 'maps', schema: GameMapSchema as ZodType<unknown> },
  { dir: 'npcs', schema: NpcSchema as ZodType<unknown> },
];

/** Đọc và kiểm tất cả file JSON trong một thư mục. Thư mục không tồn tại thì bỏ qua. */
async function readCollection<T>(
  gameDataDir: string,
  collection: Collection,
): Promise<{ checked: number; errors: ValidationError[]; values: T[] }> {
  const fullDir = join(gameDataDir, collection.dir);
  let names: string[];
  try {
    names = await readdir(fullDir);
  } catch {
    return { checked: 0, errors: [], values: [] };
  }

  const errors: ValidationError[] = [];
  const values: T[] = [];
  let checked = 0;

  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const relPath = `${collection.dir}/${name}`;
    const raw = (await readFile(join(fullDir, name), 'utf8')).replace(/^\uFEFF/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push({
        file: relPath,
        path: '',
        message: `JSON không hợp lệ: ${(error as Error).message}`,
      });
      continue;
    }
    checked += 1;
    const result = collection.schema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ file: relPath, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    values.push(result.data as T);
  }

  return { checked, errors, values };
}

/**
 * Kiểm tra liên-map: mỗi cổng phải dẫn tới một bản đồ có thật và điểm spawn có thật ở bản đồ đích.
 * Việc này không làm được trong schema của từng file vì cần thấy toàn bộ bản đồ cùng lúc.
 */
function validatePortals(maps: GameMap[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const byId = new Map(maps.map((map) => [map.id, map]));

  for (const map of maps) {
    const file = `maps/${map.id}.json`;
    for (const portal of map.portals) {
      const target = byId.get(portal.toMap);
      if (!target) {
        errors.push({
          file,
          path: `portals.${portal.id}.toMap`,
          message: `cổng dẫn tới bản đồ "${portal.toMap}" không tồn tại`,
        });
        continue;
      }
      if (!target.spawns.some((spawn) => spawn.id === portal.toSpawn)) {
        errors.push({
          file,
          path: `portals.${portal.id}.toSpawn`,
          message: `bản đồ "${target.id}" không có điểm spawn "${portal.toSpawn}"`,
        });
      }
    }
  }

  return errors;
}

/** Kiểm tra NPC đặt trên bản đồ phải có file hội thoại tương ứng. */
function validateNpcPlacements(maps: GameMap[], npcs: Npc[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const known = new Set(npcs.map((npc) => npc.id));

  for (const map of maps) {
    for (const placement of map.npcs) {
      if (!known.has(placement.id)) {
        errors.push({
          file: `maps/${map.id}.json`,
          path: `npcs.${placement.id}`,
          message: `chưa có file hội thoại cho NPC "${placement.id}" trong game-data/npcs/`,
        });
      }
    }
  }

  return errors;
}

/** Kiểm tra toàn bộ game-data. Trả về số file đã kiểm và danh sách lỗi. */
export async function validateGameData(gameDataDir: string): Promise<ValidationResult> {
  let checked = 0;
  const errors: ValidationError[] = [];
  const maps: GameMap[] = [];
  const npcs: Npc[] = [];

  for (const collection of COLLECTIONS) {
    const result = await readCollection(gameDataDir, collection);
    checked += result.checked;
    errors.push(...result.errors);
    if (collection.dir === 'maps') {
      maps.push(...(result.values as GameMap[]));
    }
    if (collection.dir === 'npcs') {
      npcs.push(...(result.values as Npc[]));
    }
  }

  // Chỉ kiểm liên-map khi từng file đã hợp lệ, tránh báo lỗi dây chuyền khó hiểu.
  if (errors.length === 0) {
    errors.push(...validatePortals(maps), ...validateNpcPlacements(maps, npcs));
  }

  return { checked, errors };
}

/** Kiểu dữ liệu hợp lệ sau khi kiểm, dùng cho server nạp game-data. */
export type ValidatedSkill = Skill;
export type ValidatedItem = Item;

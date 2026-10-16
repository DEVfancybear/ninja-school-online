import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkGameData,
  ClassDefinitionSchema,
  GameMapSchema,
  ItemSchema,
  MonsterSchema,
  NpcSchema,
  SkillSchema,
  type ClassDefinition,
  type GameDataSet,
  type GameDataIssue,
  type GameMap,
  type Item,
  type Monster,
  type Npc,
  type Skill,
} from '@ninja/shared';
import type { ZodType } from 'zod';

/** Gốc `game-data/` của repo, tính từ file này (`server/src/world/` → lên ba cấp). */
export const DEFAULT_GAME_DATA_DIR = fileURLToPath(new URL('../../../game-data', import.meta.url));

export type { GameDataIssue };

/** Lỗi nạp dữ liệu: gộp mọi vấn đề để người sửa thấy hết một lượt. */
export class GameDataError extends Error {
  readonly issues: readonly GameDataIssue[];

  constructor(issues: readonly GameDataIssue[]) {
    super(
      [
        `game-data không hợp lệ (${issues.length} lỗi):`,
        ...issues.slice(0, 12).map(formatIssue),
      ].join('\n'),
    );
    this.name = 'GameDataError';
    this.issues = issues;
  }
}

function formatIssue(issue: GameDataIssue): string {
  const at = issue.path ? `${issue.file}#${issue.path}` : issue.file;
  return `  - ${at}: ${issue.message}`;
}

/**
 * Nội dung game-data đã nạp và kiểm. Mọi hệ thống khác đọc từ đây, không tự đọc file.
 * `classes` khoá theo **trường** vì mỗi trường một file chỉ số phái.
 */
export interface GameData {
  readonly maps: ReadonlyMap<string, GameMap>;
  readonly npcs: ReadonlyMap<string, Npc>;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly skills: ReadonlyMap<string, Skill>;
  readonly items: ReadonlyMap<string, Item>;
  readonly classes: ReadonlyMap<string, ClassDefinition>;
}

/** Thư mục con của game-data: mỗi nơi có schema riêng và một khoá id riêng. */
interface Collection {
  dir: string;
  schema: ZodType<unknown>;
  push: (value: unknown) => void;
}

interface Loaded {
  checked: number;
  issues: GameDataIssue[];
}

async function readCollection(
  gameDataDir: string,
  collection: Collection,
  loaded: Loaded,
): Promise<void> {
  const dir = join(gameDataDir, collection.dir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }

  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const file = `${collection.dir}/${name}`;
    const raw = (await readFile(join(dir, name), 'utf8')).replace(/^\uFEFF/, '');
    loaded.checked += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      loaded.issues.push({
        file,
        path: '',
        message: `JSON không hợp lệ: ${(error as Error).message}`,
      });
      continue;
    }
    const result = collection.schema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        loaded.issues.push({ file, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    collection.push(result.data);
  }
}

/**
 * Nạp toàn bộ `game-data/`: kiểm schema từng file, dựng bản đồ theo id, rồi kiểm liên-file bằng
 * `checkGameData` — **cùng bộ luật** với `tools/data-validator` (chỉ khác cách báo lỗi: ở đây là
 * ném `GameDataError` để server không khởi động với dữ liệu sai).
 */
export async function loadGameData(gameDataDir: string = DEFAULT_GAME_DATA_DIR): Promise<GameData> {
  const data = {
    maps: [] as GameMap[],
    npcs: [] as Npc[],
    monsters: [] as Monster[],
    skills: [] as Skill[],
    items: [] as Item[],
    classes: [] as ClassDefinition[],
  };
  const loaded: Loaded = { checked: 0, issues: [] };

  const collections: readonly Collection[] = [
    {
      dir: 'maps',
      schema: GameMapSchema as ZodType<unknown>,
      push: (v) => data.maps.push(v as GameMap),
    },
    { dir: 'npcs', schema: NpcSchema as ZodType<unknown>, push: (v) => data.npcs.push(v as Npc) },
    {
      dir: 'monsters',
      schema: MonsterSchema as ZodType<unknown>,
      push: (v) => data.monsters.push(v as Monster),
    },
    {
      dir: 'skills',
      schema: SkillSchema as ZodType<unknown>,
      push: (v) => data.skills.push(v as Skill),
    },
    {
      dir: 'items',
      schema: ItemSchema as ZodType<unknown>,
      push: (v) => data.items.push(v as Item),
    },
    {
      dir: 'classes',
      schema: ClassDefinitionSchema as ZodType<unknown>,
      push: (v) => data.classes.push(v as ClassDefinition),
    },
  ];

  for (const collection of collections) {
    await readCollection(gameDataDir, collection, loaded);
  }

  // Chỉ kiểm liên-file khi từng file đã hợp lệ, tránh báo lỗi dây chuyền khó hiểu.
  if (loaded.issues.length === 0) {
    loaded.issues.push(...checkGameData(data as GameDataSet));
  }

  if (data.maps.length === 0) {
    loaded.issues.push({
      file: 'maps/',
      path: '',
      message: `không có bản đồ nào trong "${join(gameDataDir, 'maps')}"`,
    });
  }

  if (loaded.issues.length > 0) {
    throw new GameDataError(loaded.issues);
  }

  const index = <T>(values: readonly T[], key: (value: T) => string): ReadonlyMap<string, T> =>
    new Map(values.map((value) => [key(value), value]));

  return {
    maps: index(data.maps, (map) => map.id),
    npcs: index(data.npcs, (npc) => npc.id),
    monsters: index(data.monsters, (monster) => monster.id),
    skills: index(data.skills, (skill) => skill.id),
    items: index(data.items, (item) => item.id),
    classes: index(data.classes, (definition) => definition.school),
  };
}

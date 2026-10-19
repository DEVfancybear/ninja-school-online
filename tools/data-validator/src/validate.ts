import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkGameData,
  ClassDefinitionSchema,
  GameMapSchema,
  ItemSchema,
  MonsterSchema,
  NpcSchema,
  QuestSchema,
  SkillSchema,
  type ClassDefinition,
  type GameDataSet,
  type GameDataIssue,
  type GameMap,
  type Item,
  type Monster,
  type Npc,
  type Quest,
  type Skill,
} from '@ninja/shared';
import type { ZodType } from 'zod';

export type ValidationError = GameDataIssue;

export interface ValidationResult {
  checked: number;
  errors: ValidationError[];
}

/** Dữ liệu đọc được, còn là mảng để `checkGameData` kiểm liên-file. */
interface WritableGameDataSet {
  maps: GameMap[];
  npcs: Npc[];
  monsters: Monster[];
  skills: Skill[];
  items: Item[];
  classes: ClassDefinition[];
  quests: Quest[];
}

/** Một bộ sưu tập dữ liệu: thư mục con của game-data, schema và chỗ đổ giá trị đã kiểm. */
interface Collection {
  dir: string;
  schema: ZodType<unknown>;
  push: (value: unknown) => void;
}

function collections(target: WritableGameDataSet): readonly Collection[] {
  return [
    {
      dir: 'maps',
      schema: GameMapSchema as ZodType<unknown>,
      push: (v) => target.maps.push(v as GameMap),
    },
    { dir: 'npcs', schema: NpcSchema as ZodType<unknown>, push: (v) => target.npcs.push(v as Npc) },
    {
      dir: 'monsters',
      schema: MonsterSchema as ZodType<unknown>,
      push: (v) => target.monsters.push(v as Monster),
    },
    {
      dir: 'skills',
      schema: SkillSchema as ZodType<unknown>,
      push: (v) => target.skills.push(v as Skill),
    },
    {
      dir: 'items',
      schema: ItemSchema as ZodType<unknown>,
      push: (v) => target.items.push(v as Item),
    },
    {
      dir: 'classes',
      schema: ClassDefinitionSchema as ZodType<unknown>,
      push: (v) => target.classes.push(v as ClassDefinition),
    },
    {
      dir: 'quests',
      schema: QuestSchema as ZodType<unknown>,
      push: (v) => target.quests.push(v as Quest),
    },
  ];
}

/** Đọc và kiểm tất cả file JSON trong một thư mục. Thư mục không tồn tại thì bỏ qua. */
async function readCollection(
  gameDataDir: string,
  collection: Collection,
  errors: ValidationError[],
): Promise<number> {
  const fullDir = join(gameDataDir, collection.dir);
  let names: string[];
  try {
    names = await readdir(fullDir);
  } catch {
    return 0;
  }

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
    collection.push(result.data);
  }

  return checked;
}

/**
 * Kiểm tra toàn bộ game-data: schema từng file, rồi tới luật liên-file dùng chung với server
 * (`checkGameData` trong `@ninja/shared`).
 */
export async function validateGameData(gameDataDir: string): Promise<ValidationResult> {
  const data: WritableGameDataSet = {
    maps: [],
    npcs: [],
    monsters: [],
    skills: [],
    items: [],
    classes: [],
    quests: [],
  };
  const errors: ValidationError[] = [];
  let checked = 0;

  for (const collection of collections(data)) {
    checked += await readCollection(gameDataDir, collection, errors);
  }

  // Chỉ kiểm liên-file khi từng file đã hợp lệ, tránh báo lỗi dây chuyền khó hiểu.
  if (errors.length === 0) {
    errors.push(...checkGameData(data as GameDataSet));
  }

  return { checked, errors };
}

/** Kiểu dữ liệu hợp lệ sau khi kiểm, dùng cho server nạp game-data. */
export type ValidatedSkill = Skill;
export type ValidatedItem = Item;

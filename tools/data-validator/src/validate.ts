import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ItemSchema, SkillSchema, type Item, type Skill } from '@ninja/shared';
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

/** Thư mục con của game-data và schema tương ứng. */
const COLLECTIONS: Array<{ dir: string; schema: ZodType<Skill | Item> }> = [
  { dir: 'skills', schema: SkillSchema },
  { dir: 'items', schema: ItemSchema },
];

/** Kiểm tra mọi file JSON trong một thư mục bộ sưu tập. Thư mục không tồn tại thì bỏ qua. */
async function validateCollection(
  gameDataDir: string,
  dir: string,
  schema: ZodType<Skill | Item>,
): Promise<ValidationResult> {
  const fullDir = join(gameDataDir, dir);
  let names: string[];
  try {
    names = await readdir(fullDir);
  } catch {
    return { checked: 0, errors: [] };
  }

  const errors: ValidationError[] = [];
  let checked = 0;
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const relPath = `${dir}/${name}`;
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
    const result = schema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ file: relPath, path: issue.path.join('.'), message: issue.message });
      }
    }
  }
  return { checked, errors };
}

/** Kiểm tra toàn bộ game-data. Trả về số file đã kiểm và danh sách lỗi. */
export async function validateGameData(gameDataDir: string): Promise<ValidationResult> {
  let checked = 0;
  const errors: ValidationError[] = [];
  for (const collection of COLLECTIONS) {
    const result = await validateCollection(gameDataDir, collection.dir, collection.schema);
    checked += result.checked;
    errors.push(...result.errors);
  }
  return { checked, errors };
}

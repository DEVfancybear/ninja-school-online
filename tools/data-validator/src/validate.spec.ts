import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateGameData } from './validate.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ninja-data-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(relPath: string, content: unknown): Promise<void> {
  const full = join(dir, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
}

const skill = {
  id: 'skill-tram-co-ban',
  name: 'Trảm Cơ Bản',
  school: 'haruna',
  class: 'dao',
  type: 'active',
  levelRequired: 1,
  costMp: 5,
  cooldownMs: 0,
  targets: 1,
  power: 10,
  scale: { stat: 'strength', factor: 1.2 },
};

describe('validateGameData', () => {
  it('bỏ qua khi thư mục chưa có dữ liệu', async () => {
    expect(await validateGameData(dir)).toEqual({ checked: 0, errors: [] });
  });

  it('chấp nhận dữ liệu hợp lệ', async () => {
    await write('skills/skill-tram-co-ban.json', skill);
    const result = await validateGameData(dir);
    expect(result.checked).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('báo lỗi kèm đường dẫn trường sai', async () => {
    await write('skills/skill-loi.json', { ...skill, id: 'skill-loi', costMp: -3 });
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: 'skills/skill-loi.json', path: 'costMp' });
  });

  it('báo lỗi khi file không phải JSON hợp lệ', async () => {
    await write('items/item-hong.json', '{ khong-phai-json');
    const result = await validateGameData(dir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/JSON không hợp lệ/);
  });
});

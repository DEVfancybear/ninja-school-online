import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_GAME_DATA_DIR } from '../world/game-data.js';

/** Sáu thư mục con của game-data; bản sao dùng cho kiểm thử phải có **đủ cả sáu**. */
export const GAME_DATA_COLLECTIONS = ['maps', 'npcs', 'monsters', 'skills', 'items', 'classes'] as const;
export type CollectionDir = (typeof GAME_DATA_COLLECTIONS)[number];

/** Nội dung một bộ game-data, khoá theo đường dẫn tương đối (`maps/lang-khoi-nguon.json`). */
export type GameDataFiles = Record<CollectionDir, Record<string, Record<string, unknown>>>;

const temporaryDirs: string[] = [];

/** Tạo một thư mục game-data tạm từ các file cho trước (đường dẫn tương đối → nội dung JSON). */
export async function makeGameDataDir(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ninja-game-data-'));
  temporaryDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    if (content === undefined) {
      // `undefined` = cố ý không tạo file này (dùng để thử dữ liệu thiếu).
      continue;
    }
    const fullPath = join(dir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

async function readGameDataFile(relativePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(DEFAULT_GAME_DATA_DIR, relativePath), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Bản sao **đầy đủ** dữ liệu thật (mọi thư mục con), sửa bằng `mutate` để tạo ca thử có kiểm soát.
 * Bản sao thiếu thư mục sẽ tự sinh lỗi "quái trên bản đồ chưa có file" — không phải điều cần thử.
 */
export async function copyGameDataDir(mutate: (files: GameDataFiles) => void): Promise<string> {
  const files = {
    maps: {},
    npcs: {},
    monsters: {},
    skills: {},
    items: {},
    classes: {},
  } as GameDataFiles;

  for (const dir of GAME_DATA_COLLECTIONS) {
    for (const name of (await readdir(join(DEFAULT_GAME_DATA_DIR, dir))).sort()) {
      if (name.endsWith('.json')) {
        files[dir][`${dir}/${name}`] = await readGameDataFile(`${dir}/${name}`);
      }
    }
  }

  mutate(files);
  return makeGameDataDir(Object.assign({}, ...GAME_DATA_COLLECTIONS.map((dir) => files[dir])));
}

/** Xoá mọi thư mục tạm đã tạo (gọi trong `afterAll`). */
export async function removeTemporaryGameDataDirs(): Promise<void> {
  for (const dir of temporaryDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

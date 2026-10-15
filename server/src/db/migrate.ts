import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client.js';
import { loadRepoDotEnv } from '../config/dotenv.js';
import { loadEnv } from '../config/env.js';

/** Thư mục chứa file migration, tính từ vị trí file này (đúng cả khi chạy src/ hoặc dist/). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Chạy toàn bộ migration còn thiếu. Dùng cho cả CLI và kiểm thử. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 2);
  try {
    await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// Chạy trực tiếp: `pnpm db:migrate` (so sánh qua pathToFileURL để đúng trên Windows).
const invokedPath = process.argv[1];
const isDirectRun =
  invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;
if (isDirectRun) {
  loadRepoDotEnv();
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);
  console.log(`Đã chạy migration cho ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
}

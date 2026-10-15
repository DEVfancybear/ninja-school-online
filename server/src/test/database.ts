import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createDb, createPool, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Database dùng cho kiểm thử. Tách hẳn khỏi database phát triển để không làm mất dữ liệu thật.
 * Đổi bằng biến môi trường TEST_DATABASE_URL (CI truyền vào).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://ninja:ninja_dev_password@127.0.0.1:5432/ninja_test';

let pool: Pool | undefined;
let db: Db | undefined;

/** Kết nối database kiểm thử (tạo một lần cho mỗi tiến trình kiểm thử). */
export async function getTestDb(): Promise<Db> {
  if (!db) {
    pool = createPool(TEST_DATABASE_URL, 4);
    db = createDb(pool);
  }
  return db;
}

/** Xoá sạch dữ liệu giữa các test, giữ nguyên cấu trúc bảng. */
export async function resetDatabase(): Promise<void> {
  const database = await getTestDb();
  await database.execute(
    sql`truncate table ${sql.identifier('refresh_tokens')}, ${sql.identifier('characters')}, ${sql.identifier('accounts')} restart identity cascade`,
  );
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Chạy migration cho database kiểm thử (dùng trong globalSetup của Vitest). */
export async function prepareTestDatabase(): Promise<void> {
  await runMigrations(TEST_DATABASE_URL);
}

import { prepareTestDatabase, TEST_DATABASE_URL } from './database.js';

/** Chạy một lần trước toàn bộ test: bảo đảm database kiểm thử đã có cấu trúc bảng. */
export default async function setup(): Promise<void> {
  try {
    await prepareTestDatabase();
  } catch (error) {
    throw new Error(
      `Không kết nối được database kiểm thử (${TEST_DATABASE_URL}). ` +
        'Hãy chạy PostgreSQL trước, ví dụ: docker compose -f infra/docker/docker-compose.dev.yml up -d',
      { cause: error },
    );
  }
}

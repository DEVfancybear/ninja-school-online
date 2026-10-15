import { fileURLToPath } from 'node:url';

/** Đường dẫn file .env ở gốc repo (đúng cho cả khi chạy từ src/ lẫn dist/). */
export const REPO_DOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * Nạp .env ở gốc repo nếu có, dùng API có sẵn của Node (không cần thư viện dotenv).
 * Không có file thì bỏ qua: biến môi trường thật (CI, Docker, systemd) vẫn được dùng.
 */
export function loadRepoDotEnv(): void {
  try {
    process.loadEnvFile(REPO_DOT_ENV);
  } catch {
    // Không có .env: giữ nguyên môi trường hiện tại.
  }
}

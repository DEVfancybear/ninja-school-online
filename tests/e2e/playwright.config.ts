import { defineConfig, devices } from '@playwright/test';

const SERVER_URL = 'http://127.0.0.1:3000';
/**
 * Cổng của client khi chạy e2e. Mặc định 4200; đổi bằng `NINJA_E2E_CLIENT_PORT` khi cổng đó đang
 * bận (ví dụ một dự án khác đang chạy dev server) — `reuseExistingServer` sẽ tưởng nhầm là app của
 * mình và kiểm thử sẽ chạy trên nhầm trang.
 */
const CLIENT_PORT = Number(process.env.NINJA_E2E_CLIENT_PORT ?? 4200);
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

/**
 * Kiểm thử đầu-cuối bằng trình duyệt thật.
 * Dùng đúng cấu hình phát triển (server đọc .env ở gốc repo, client chạy ng serve với proxy /api).
 * Mỗi lần chạy dùng tên tài khoản/nhân vật sinh ngẫu nhiên nên không cần xoá dữ liệu cũ.
 */
export default defineConfig({
  testDir: './src',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: CLIENT_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @ninja/server dev',
      url: `${SERVER_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      // --host 0.0.0.0: mặc định của Angular chỉ bind IPv6 [::1] nên 127.0.0.1 không kết nối được.
      command: `pnpm --filter @ninja/client dev --host 0.0.0.0 --port ${CLIENT_PORT}`,
      url: CLIENT_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
    },
  ],
});

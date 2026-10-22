import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = Number(process.env.NINJA_E2E_SERVER_PORT ?? 3000);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
/**
 * Cổng server/client khi chạy E2E. Dùng `NINJA_E2E_SERVER_PORT` và `NINJA_E2E_CLIENT_PORT` để
 * tránh chạm dev server người dùng; proxy của client trỏ vào đúng server-port này.
 */
const CLIENT_PORT = Number(process.env.NINJA_E2E_CLIENT_PORT ?? 4200);
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
const DEDICATED_DATABASE_URL = process.env.NINJA_E2E_DATABASE_URL;
const REUSE_SERVER = !process.env.CI && !DEDICATED_DATABASE_URL;

/**
 * Kiểm thử đầu-cuối bằng trình duyệt thật.
 * Chế độ thường dùng cấu hình phát triển. Để kiểm thử cô lập, đặt `NINJA_E2E_DATABASE_URL` vào DB
 * disposable và hai biến port ở trên; cấu hình sẽ không tái sử dụng server đang chạy. Mỗi lần chạy
 * vẫn tạo tên duy nhất, nhưng không coi dữ liệu của DB dùng chung là dữ liệu có thể xoá.
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
      env: {
        HOST: '127.0.0.1',
        PORT: String(SERVER_PORT),
        CORS_ORIGIN: CLIENT_URL,
        ...(DEDICATED_DATABASE_URL ? { DATABASE_URL: DEDICATED_DATABASE_URL } : {}),
      },
      reuseExistingServer: REUSE_SERVER,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      // --host 0.0.0.0: mặc định của Angular chỉ bind IPv6 [::1] nên 127.0.0.1 không kết nối được.
      command: `pnpm --filter @ninja/client dev --host 0.0.0.0 --port ${CLIENT_PORT} --proxy-config proxy.e2e.conf.cjs`,
      url: CLIENT_URL,
      env: { NINJA_E2E_SERVER_PORT: String(SERVER_PORT) },
      reuseExistingServer: REUSE_SERVER,
      timeout: 180_000,
      stdout: 'pipe',
    },
  ],
});

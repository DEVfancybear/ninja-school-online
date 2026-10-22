import { defineConfig, devices } from '@playwright/test';
import { validateE2eSafety } from './config/safety.js';

const DEDICATED_DATABASE_URL = process.env.NINJA_E2E_DATABASE_URL;
const { serverPort: SERVER_PORT, clientPort: CLIENT_PORT } = validateE2eSafety({
  databaseUrl: DEDICATED_DATABASE_URL,
  serverPort: Number(process.env.NINJA_E2E_SERVER_PORT ?? 3307),
  clientPort: Number(process.env.NINJA_E2E_CLIENT_PORT ?? 4307),
});
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
const REUSE_SERVER = false;

/**
 * Kiểm thử đầu-cuối bằng trình duyệt thật; luôn yêu cầu DB disposable chính xác `ninja_m7_e2e`,
 * cổng non-dev, và server không được tái sử dụng. Mỗi lần chạy vẫn tạo tên duy nhất, nhưng không
 * coi dữ liệu của DB dùng chung là dữ liệu có thể xoá.
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
        ...(DEDICATED_DATABASE_URL
          ? {
              DATABASE_URL: DEDICATED_DATABASE_URL,
              FIELD_BOSS_INTERVAL_MINUTES: '1',
              FIELD_BOSS_WINDOW_MINUTES: '1',
              FIELD_BOSS_START_OFFSET_MINUTES: '0',
            }
          : {}),
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

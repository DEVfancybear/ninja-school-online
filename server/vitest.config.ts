import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    // Các test dùng chung một database nên phải chạy tuần tự, tránh xoá dữ liệu của nhau.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

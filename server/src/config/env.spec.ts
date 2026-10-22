import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('dùng giá trị mặc định khi thiếu biến', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.NODE_ENV).toBe('development');
  });

  it('ép kiểu PORT từ chuỗi sang số', () => {
    expect(loadEnv({ PORT: '4321' }).PORT).toBe(4321);
  });

  it('bật event M7 mặc định và cho operator tắt bằng biến cấu hình', () => {
    expect(loadEnv({}).M7_EVENT_ENABLED).toBe(true);
    expect(loadEnv({ M7_EVENT_ENABLED: 'false' }).M7_EVENT_ENABLED).toBe(false);
  });

  it('từ chối giá trị bật event M7 không hợp lệ', () => {
    expect(() => loadEnv({ M7_EVENT_ENABLED: 'yes' })).toThrow(/không hợp lệ/);
  });

  it('dùng lịch boss UTC 15 phút đầu mỗi giờ và cho operator cấu hình lịch', () => {
    expect(loadEnv({}).FIELD_BOSS_INTERVAL_MINUTES).toBe(60);
    expect(loadEnv({}).FIELD_BOSS_WINDOW_MINUTES).toBe(15);
    expect(loadEnv({ FIELD_BOSS_INTERVAL_MINUTES: '120', FIELD_BOSS_WINDOW_MINUTES: '30', FIELD_BOSS_START_OFFSET_MINUTES: '30' })).toMatchObject({
      FIELD_BOSS_INTERVAL_MINUTES: 120,
      FIELD_BOSS_WINDOW_MINUTES: 30,
      FIELD_BOSS_START_OFFSET_MINUTES: 30,
    });
  });

  it('từ chối cửa sổ boss dài hơn chu kỳ', () => {
    expect(() => loadEnv({ FIELD_BOSS_INTERVAL_MINUTES: '10', FIELD_BOSS_WINDOW_MINUTES: '11' })).toThrow(/không hợp lệ/);
  });

  it('từ chối offset boss nằm ngoài chu kỳ', () => {
    expect(() => loadEnv({ FIELD_BOSS_INTERVAL_MINUTES: '60', FIELD_BOSS_START_OFFSET_MINUTES: '60' })).toThrow(/không hợp lệ/);
  });

  it('từ chối PORT không hợp lệ', () => {
    expect(() => loadEnv({ PORT: 'khong-phai-so' })).toThrow(/không hợp lệ/);
    expect(() => loadEnv({ PORT: '70000' })).toThrow(/không hợp lệ/);
  });
});

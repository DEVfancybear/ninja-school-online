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

  it('từ chối PORT không hợp lệ', () => {
    expect(() => loadEnv({ PORT: 'khong-phai-so' })).toThrow(/không hợp lệ/);
    expect(() => loadEnv({ PORT: '70000' })).toThrow(/không hợp lệ/);
  });
});

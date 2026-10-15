import { describe, expect, it } from 'vitest';
import { WS_PATH, currentWsUrl, wsUrlFor } from './ws-url';

describe('wsUrlFor', () => {
  it('giữ nguyên host và đổi http thành ws', () => {
    expect(wsUrlFor({ protocol: 'http:', host: 'localhost:4200' })).toBe('ws://localhost:4200/ws');
  });

  it('đổi https thành wss', () => {
    expect(wsUrlFor({ protocol: 'https:', host: 'ninja.example' })).toBe('wss://ninja.example/ws');
  });

  it('đường dẫn mặc định đúng như dev proxy chuyển tiếp', () => {
    expect(WS_PATH).toBe('/ws');
  });
});

describe('currentWsUrl', () => {
  it('dùng origin của trang đang mở', () => {
    const expected = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    expect(currentWsUrl()).toBe(expected);
  });

  it('dùng origin truyền vào khi không có location', () => {
    expect(currentWsUrl('/ws', { protocol: 'http:', host: 'example.test' })).toBe(
      'ws://example.test/ws',
    );
  });
});

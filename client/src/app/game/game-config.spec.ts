import { vi } from 'vitest';

// jsdom không cài đặt canvas 2D nên không thể nạp Phaser thật trong unit test.
// Mock đủ nhỏ để kiểm tra phần cấu hình; phần vẽ thật được kiểm bằng `ng build` + chạy `ng serve`.
vi.mock('phaser', () => ({
  default: {
    AUTO: 'AUTO',
    Scale: { RESIZE: 'RESIZE', CENTER_BOTH: 'CENTER_BOTH' },
    Scene: class {},
  },
}));

import Phaser from 'phaser';
import { buildGameConfig, WORLD_BACKGROUND_COLOR } from './game-config';
import { WorldScene } from './world-scene';

describe('buildGameConfig', () => {
  const host = document.createElement('div');

  it('gắn Phaser vào đúng phần tử cha', () => {
    expect(buildGameConfig(host).parent).toBe(host);
  });

  it('dùng cảnh thế giới và chế độ co giãn RESIZE', () => {
    const config = buildGameConfig(host);
    expect(config.scene).toEqual([WorldScene]);
    expect(config.scale?.mode).toBe(Phaser.Scale.RESIZE);
    expect(config.scale?.autoCenter).toBe(Phaser.Scale.CENTER_BOTH);
  });

  it('dùng màu nền của thế giới', () => {
    expect(buildGameConfig(host).backgroundColor).toBe(WORLD_BACKGROUND_COLOR);
  });
});

import Phaser from 'phaser';
import { WorldScene } from './world-scene';

/** Màu nền sân khấu thế giới (khớp biến --bg trong styles.css). */
export const WORLD_BACKGROUND_COLOR = '#0b1218';

/**
 * Cấu hình Phaser cho sân khấu thế giới 2D.
 * Tách riêng khỏi component để kiểm thử được cấu hình mà không cần khởi tạo Phaser.
 */
export function buildGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: WORLD_BACKGROUND_COLOR,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: { pixelArt: true },
    scene: [WorldScene],
  };
}

import Phaser from 'phaser';

/** Màu nền sân khấu thế giới (khớp biến --bg trong styles.css). */
export const WORLD_BACKGROUND_COLOR = '#0b1218';

/**
 * Cấu hình Phaser cho sân khấu thế giới 2D.
 * Tách riêng khỏi component để kiểm thử được cấu hình mà không cần khởi tạo Phaser.
 *
 * `scene` nhận **thể hiện** cảnh (Phaser cho phép điều này) để component truyền được
 * `hooks` vào hàm dựng của `WorldScene` mà không phải mượn registry của Phaser.
 */
export function buildGameConfig(
  parent: HTMLElement,
  scene: Phaser.Scene,
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: WORLD_BACKGROUND_COLOR,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: { pixelArt: true },
    scene: [scene],
  };
}

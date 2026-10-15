import Phaser from 'phaser';

/** Kích thước một ô gạch tham chiếu (pixel) ở bản dựng khung. */
export const TILE_SIZE = 32;

/**
 * Cảnh thế giới ở bản dựng khung M0.
 * Hiện chỉ vẽ lưới gạch mẫu để chứng minh Phaser chạy được trong Angular;
 * tilemap thật sẽ được nạp từ game-data/maps/ ở các cột mốc sau.
 */
export class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    const grid = this.add.graphics();
    grid.lineStyle(1, 0x1d2b36, 1);
    for (let x = 0; x <= width; x += TILE_SIZE) {
      grid.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += TILE_SIZE) {
      grid.lineBetween(0, y, width, y);
    }

    this.add
      .text(width / 2, height / 2, 'Thế giới ninja — bản dựng khung (M0)', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#e8f1f8',
      })
      .setOrigin(0.5);
  }
}

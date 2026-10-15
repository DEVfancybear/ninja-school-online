import Phaser from 'phaser';
import { parseHexColor, type MapTile } from './world-logic';

/**
 * Vẽ gạch và nhân vật bằng hình khối sinh ra trong mã, **không dùng tài nguyên hình** nào.
 *
 * Dự án chưa có tài nguyên đồ họa (xem `assets/README.md`) và sẽ không sao chép tài nguyên của game
 * khác, nên bản M2 dựng hình ảnh từ hình khối. Mục tiêu là để bản đồ trông ra một thế giới chứ không
 * phải lưới ô màu: mỗi loại gạch có hoa văn riêng, nhân vật có thân/hình riêng chứ không phải ô vuông.
 *
 * Mọi chi tiết lấy từ số giả ngẫu nhiên **xác định** theo `(cột, hàng)` nên cùng một bản đồ luôn vẽ
 * giống nhau, không bị "nhấp nháy" mỗi lần vẽ lại.
 */

/** Id gạch trong `game-data/maps/*.json`; `MapSnapshot` chỉ gửi id + màu nên phải tra theo bảng này. */
const TILE_GRASS = 0;
const TILE_PATH = 1;
const TILE_WATER = 2;
const TILE_WALL = 3;
const TILE_ROOF = 4;
const TILE_TREE = 5;
const TILE_ROCK = 6;
const TILE_SAND = 7;
const TILE_FENCE = 8;

/** Số giả ngẫu nhiên xác định trong [0, 1) — cùng (cột, hàng, muối) luôn ra cùng kết quả. */
function rand01(col: number, row: number, salt: number): number {
  let h =
    Math.imul(col + 1, 73856093) ^ Math.imul(row + 1, 19349663) ^ Math.imul(salt + 1, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Làm sáng (`amount` > 0) hoặc tối (`amount` < 0) một màu, giữ nguyên kênh alpha. */
function shade(color: number, amount: number): number {
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  const r = clamp(((color >> 16) & 0xff) + 255 * amount);
  const g = clamp(((color >> 8) & 0xff) + 255 * amount);
  const b = clamp((color & 0xff) + 255 * amount);
  return (r << 16) | (g << 8) | b;
}

/** Vẽ lớp gạch: `ground` phủ kín ô, `decor` chỉ vẽ vật thể (để nền bên dưới lộ ra). */
export type TileLayerKind = 'ground' | 'decor';

/**
 * Vẽ một ô gạch. `originX/originY` là góc trên-trái của ô theo pixel.
 *
 * Gạch lạ (id chưa có trong bảng, ví dụ dữ liệu mới thêm) vẫn được vẽ bằng ô màu trơn của nó để
 * không bao giờ ra ô trống.
 */
export function drawTile(
  graphics: Phaser.GameObjects.Graphics,
  tile: MapTile,
  col: number,
  row: number,
  size: number,
  layer: TileLayerKind,
): void {
  const x = col * size;
  const y = row * size;
  const color = parseHexColor(tile.color);
  const ground = layer === 'ground';

  switch (tile.id) {
    case TILE_GRASS:
      if (ground) {
        drawGrass(graphics, x, y, size, col, row, color);
      }
      break;
    case TILE_PATH:
      drawDirt(graphics, x, y, size, col, row, color, ground);
      break;
    case TILE_WATER:
      drawWater(graphics, x, y, size, col, row, color, ground);
      break;
    case TILE_WALL:
      drawWall(graphics, x, y, size, color, ground);
      break;
    case TILE_ROOF:
      drawRoof(graphics, x, y, size, color, ground);
      break;
    case TILE_TREE:
      if (ground) {
        drawGrass(graphics, x, y, size, col, row, color);
      }
      drawTree(graphics, x, y, size, color);
      break;
    case TILE_ROCK:
      if (ground) {
        drawGrass(graphics, x, y, size, col, row, color);
      }
      drawRock(graphics, x, y, size, color, col, row);
      break;
    case TILE_SAND:
      drawSand(graphics, x, y, size, col, row, color, ground);
      break;
    case TILE_FENCE:
      if (ground) {
        drawGrass(graphics, x, y, size, col, row, color);
      }
      drawFence(graphics, x, y, size, color);
      break;
    default:
      if (ground) {
        graphics.fillStyle(color, 1);
        graphics.fillRect(x, y, size, size);
      }
      break;
  }
}

// ------------------------------------------------------------------ từng loại gạch

/** Cỏ: nền xanh + từng nhánh cỏ nhỏ, không kẻ lưới ô. */
function drawGrass(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
): void {
  graphics.fillStyle(color, 1);
  graphics.fillRect(x, y, size, size);

  const lighter = shade(color, 0.06);
  const darker = shade(color, -0.05);
  for (let i = 0; i < 9; i += 1) {
    const bx = x + 2 + rand01(col, row, i * 3) * (size - 4);
    const by = y + 2 + rand01(col, row, i * 3 + 1) * (size - 4);
    const tall = rand01(col, row, i * 3 + 2) > 0.5 ? 3 : 2;
    graphics.fillStyle(rand01(col, row, i * 3 + 2) > 0.5 ? lighter : darker, 1);
    graphics.fillRect(bx, by, 1, tall);
  }
}

/** Đường đất: nền nâu + sỏi nhỏ và vài mảng sáng. */
function drawDirt(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  ground: boolean,
): void {
  if (ground) {
    graphics.fillStyle(color, 1);
    graphics.fillRect(x, y, size, size);
  }
  const light = shade(color, 0.07);
  const dark = shade(color, -0.08);
  for (let i = 0; i < 5; i += 1) {
    const px = x + 3 + rand01(col, row, i * 5 + 1) * (size - 7);
    const py = y + 3 + rand01(col, row, i * 5 + 2) * (size - 7);
    graphics.fillStyle(rand01(col, row, i * 5 + 3) > 0.45 ? light : dark, 1);
    graphics.fillEllipse(px, py, 3, 2);
  }
}

/** Nước: nền xanh đậm + gợn sóng sáng, bờ tối ở mép dưới. */
function drawWater(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  ground: boolean,
): void {
  if (ground) {
    graphics.fillStyle(color, 1);
    graphics.fillRect(x, y, size, size);
  }
  const foam = shade(color, 0.16);
  for (let i = 0; i < 3; i += 1) {
    const wy = y + 6 + i * 9 + rand01(col, row, i + 40) * 3;
    const wx = x + 3 + rand01(col, row, i + 50) * 8;
    const wide = size - 8 - rand01(col, row, i + 60) * 6;
    graphics.fillStyle(foam, 0.5);
    graphics.fillRect(wx, wy, wide, 1);
    graphics.fillRect(wx + 3, wy + 2, Math.max(2, wide - 6), 1);
  }
  if (ground) {
    graphics.fillStyle(shade(color, -0.08), 0.5);
    graphics.fillRect(x, y + size - 2, size, 2);
  }
}

/** Tường: gạch xây so le, có mạch vữa. */
function drawWall(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  ground: boolean,
): void {
  if (ground) {
    graphics.fillStyle(shade(color, -0.14), 1);
    graphics.fillRect(x, y, size, size);
  }
  const brick = shade(color, 0.05);
  const brickAlt = shade(color, -0.02);
  const mortar = shade(color, -0.16);
  const rowHeight = Math.max(6, Math.round(size / 4));
  for (let r = 0; r * rowHeight < size; r += 1) {
    const by = y + r * rowHeight;
    const offset = r % 2 === 0 ? 0 : Math.round(size / 4);
    for (let bx = x - offset; bx < x + size; bx += Math.round(size / 2)) {
      const left = Math.max(x, bx);
      const right = Math.min(x + size, bx + Math.round(size / 2) - 1);
      if (right <= left) {
        continue;
      }
      graphics.fillStyle(r % 2 === 0 ? brick : brickAlt, 1);
      graphics.fillRect(left, by, right - left, rowHeight - 1);
    }
  }
  graphics.fillStyle(mortar, 0.55);
  graphics.fillRect(x, y, size, 1);
  graphics.fillRect(x, y, 1, size);
}

/** Mái nhà: hàng ngói uốn lượn + bờ nóc sáng. */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  ground: boolean,
): void {
  if (ground) {
    graphics.fillStyle(shade(color, -0.1), 1);
    graphics.fillRect(x, y, size, size);
  }
  const tile = shade(color, 0.05);
  const shadow = shade(color, -0.12);
  const rowHeight = Math.max(7, Math.round(size / 3));
  for (let r = 0; r * rowHeight < size; r += 1) {
    const by = y + r * rowHeight;
    graphics.fillStyle(r % 2 === 0 ? tile : shade(color, -0.03), 1);
    graphics.fillRect(x, by, size, rowHeight - 1);
    graphics.fillStyle(shadow, 0.7);
    graphics.fillRect(x, by + rowHeight - 2, size, 2);
    for (let bx = x + 2; bx < x + size; bx += 7) {
      graphics.fillStyle(shadow, 0.35);
      graphics.fillRect(bx, by + 2, 1, rowHeight - 5);
    }
  }
  graphics.fillStyle(shade(color, 0.18), 0.9);
  graphics.fillRect(x, y, size, 2);
}

/** Cây: thân + ba tán lá chồng nhau, có mảng sáng ở trên-trái. */
function drawTree(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
): void {
  const cx = x + size / 2;
  const base = y + size - 2;
  graphics.fillStyle(0x3d2a19, 1);
  graphics.fillRect(cx - 2, base - size * 0.35, 4, size * 0.35);

  const dark = shade(color, -0.06);
  const mid = shade(color, 0.04);
  const light = shade(color, 0.16);
  graphics.fillStyle(dark, 1);
  graphics.fillCircle(cx, y + size * 0.42, size * 0.34);
  graphics.fillCircle(cx - size * 0.24, y + size * 0.55, size * 0.24);
  graphics.fillCircle(cx + size * 0.24, y + size * 0.54, size * 0.24);
  graphics.fillStyle(mid, 1);
  graphics.fillCircle(cx - 2, y + size * 0.4, size * 0.26);
  graphics.fillStyle(light, 0.85);
  graphics.fillCircle(cx - size * 0.12, y + size * 0.32, size * 0.13);
}

/** Đá: khối đa giác xám + mặt sáng phía trên. */
function drawRock(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  col: number,
  row: number,
): void {
  const w = size * (0.6 + rand01(col, row, 71) * 0.2);
  const cx = x + size / 2;
  const bottom = y + size * 0.82;
  const top = y + size * 0.3;
  graphics.fillStyle(shade(color, -0.08), 1);
  graphics.fillTriangle(cx - w / 2, bottom, cx + w / 2, bottom, cx, top);
  graphics.fillStyle(color, 1);
  graphics.fillTriangle(cx - w / 2 + 3, bottom - 2, cx + w / 2 - 3, bottom - 2, cx, top + 3);
  graphics.fillStyle(shade(color, 0.14), 1);
  graphics.fillTriangle(cx - w / 4, bottom - 5, cx, bottom - 5, cx - 2, top + 7);
}

/** Cát: nền vàng nhạt + hạt sạn. */
function drawSand(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  ground: boolean,
): void {
  if (ground) {
    graphics.fillStyle(color, 1);
    graphics.fillRect(x, y, size, size);
  }
  const dark = shade(color, -0.07);
  for (let i = 0; i < 7; i += 1) {
    const px = x + 2 + rand01(col, row, i * 7 + 2) * (size - 4);
    const py = y + 2 + rand01(col, row, i * 7 + 3) * (size - 4);
    graphics.fillStyle(dark, 0.7);
    graphics.fillRect(px, py, 1, 1);
  }
}

/** Hàng rào: hai thanh ngang + cột, đi được (chỉ để trang trí). */
function drawFence(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
): void {
  const rail = shade(color, 0.08);
  const post = shade(color, -0.05);
  const top = y + size * 0.42;
  const bottom = y + size * 0.74;
  graphics.fillStyle(rail, 1);
  graphics.fillRect(x, top, size, 3);
  graphics.fillRect(x, bottom, size, 3);
  graphics.fillStyle(post, 1);
  for (let bx = x + 2; bx < x + size; bx += Math.round(size / 3)) {
    graphics.fillRect(bx, top - 4, 3, bottom - top + 9);
  }
}

// ------------------------------------------------------------------ nhân vật

/** Hướng nhìn của nhân vật; 8 hướng của hợp đồng gộp lại thành 3 kiểu vẽ. */
export type LookDirection = 'down' | 'up' | 'side';

export function lookDirection(
  facing: string,
  flipSide: boolean,
): { look: LookDirection; mirrored: boolean } {
  switch (facing) {
    case 'n':
    case 'ne':
    case 'nw':
      return { look: 'up', mirrored: facing === 'nw' };
    case 'e':
    case 'se':
      return { look: 'side', mirrored: false };
    case 'w':
    case 'sw':
      return { look: 'side', mirrored: true };
    default:
      return { look: 'down', mirrored: flipSide };
  }
}

export interface CharacterArt {
  readonly color: number;
  /** Chiều cao thân (pixel) — NPC cao hơn người chơi. */
  readonly height: number;
  /** Nhân vật của mình: thêm vòng sáng dưới chân cho dễ nhìn. */
  readonly highlight: boolean;
  /** NPC đội nón và có râu. */
  readonly elder: boolean;
}

const SKIN = 0xf0c9a0;
const SKIN_SHADOW = 0xd6a97f;
const HAIR = 0x2b2320;
const OUTLINE = 0x121a22;
const LEGS = 0x2c3340;

/**
 * Vẽ một nhân vật: bóng, chân, thân, tay, đầu, băng đô và mắt quay theo hướng đi.
 * Gốc toạ độ là **điểm giữa thân**, khớp với quy ước toạ độ của server.
 */
export function drawCharacter(
  graphics: Phaser.GameObjects.Graphics,
  art: CharacterArt,
  direction: { look: LookDirection; mirrored: boolean },
): void {
  const scale = art.height / 30;
  const bodyWidth = Math.round(14 * scale);
  const bodyHeight = Math.round(12 * scale);
  const headRadius = 6.5 * scale;
  const feetY = Math.round(12 * scale);
  const bodyTop = feetY - Math.round(5 * scale) - bodyHeight;
  const headCenterY = bodyTop - headRadius + 1;
  const torso = art.color;

  // Bóng đổ dưới chân: cho cảm giác nhân vật đứng trên mặt đất.
  graphics.fillStyle(0x000000, 0.22);
  graphics.fillEllipse(0, feetY + 1, bodyWidth + 6, 6 * scale);

  if (art.highlight) {
    graphics.fillStyle(0x7fd1ff, 0.16);
    graphics.fillEllipse(0, feetY + 1, bodyWidth + 16, 11 * scale);
  }

  const legTop = feetY - Math.round(5 * scale);
  graphics.fillStyle(LEGS, 1);
  if (direction.look === 'side') {
    graphics.fillRect(-Math.round(4 * scale), legTop, Math.round(7 * scale), feetY - legTop);
  } else {
    graphics.fillRect(-Math.round(5 * scale), legTop, Math.round(4 * scale), feetY - legTop);
    graphics.fillRect(Math.round(1 * scale), legTop, Math.round(4 * scale), feetY - legTop);
  }

  // Thân: áo đồng phục + đường viền tối để tách khỏi nền.
  graphics.fillStyle(OUTLINE, 0.9);
  graphics.fillRoundedRect(-bodyWidth / 2 - 1, bodyTop - 1, bodyWidth + 2, bodyHeight + 2, 4);
  graphics.fillStyle(torso, 1);
  graphics.fillRoundedRect(-bodyWidth / 2, bodyTop, bodyWidth, bodyHeight, 3);
  graphics.fillStyle(shade(torso, -0.12), 1);
  graphics.fillRect(-bodyWidth / 2, bodyTop + bodyHeight - 3, bodyWidth, 3);

  // Tay: hướng ngang thì một tay ra trước, còn lại giấu sau thân.
  graphics.fillStyle(shade(torso, 0.08), 1);
  if (direction.look === 'side') {
    const armX = direction.mirrored ? -bodyWidth / 2 - 2 : bodyWidth / 2 - 1;
    graphics.fillRect(armX, bodyTop + 2, 3 * scale, Math.round(8 * scale));
  } else {
    graphics.fillRect(-bodyWidth / 2 - 2, bodyTop + 2, 2 * scale, Math.round(8 * scale));
    graphics.fillRect(bodyWidth / 2, bodyTop + 2, 2 * scale, Math.round(8 * scale));
  }

  // Đầu + tóc.
  graphics.fillStyle(OUTLINE, 0.9);
  graphics.fillCircle(0, headCenterY, headRadius + 1);
  graphics.fillStyle(SKIN, 1);
  graphics.fillCircle(0, headCenterY, headRadius);
  if (direction.look === 'up') {
    graphics.fillStyle(HAIR, 1);
    graphics.fillCircle(0, headCenterY, headRadius);
    graphics.fillStyle(shade(HAIR, 0.1), 1);
    graphics.fillCircle(0, headCenterY + 1.5, headRadius * 0.7);
  } else {
    graphics.fillStyle(HAIR, 1);
    graphics.fillCircle(0, headCenterY - headRadius * 0.55, headRadius * 0.95);
    graphics.fillStyle(SKIN_SHADOW, 0.5);
    graphics.fillCircle(0, headCenterY + headRadius * 0.45, headRadius * 0.55);
  }

  // Băng đô mang màu của trường/phái: dấu nhận biết chính của nhân vật ninja.
  const bandHeight = Math.max(2, Math.round(2.6 * scale));
  graphics.fillStyle(0xd8443f, 1);
  graphics.fillRect(-headRadius, headCenterY - headRadius * 0.85, headRadius * 2, bandHeight);
  if (direction.look !== 'down') {
    graphics.fillRect(-headRadius - 2, headCenterY - 2, 3, bandHeight - 1);
  }

  // Mắt: hướng lên thì không thấy mặt.
  if (direction.look !== 'up') {
    graphics.fillStyle(OUTLINE, 1);
    const eyeY = headCenterY + 1.5;
    const eyeR = Math.max(0.9, 1.2 * scale);
    if (direction.look === 'side') {
      graphics.fillCircle(direction.mirrored ? -headRadius * 0.4 : headRadius * 0.4, eyeY, eyeR);
    } else {
      graphics.fillCircle(-headRadius * 0.42, eyeY, eyeR);
      graphics.fillCircle(headRadius * 0.42, eyeY, eyeR);
    }
  }

  if (art.elder) {
    // Nón lá + râu: NPC trông khác người chơi ngay từ xa.
    graphics.fillStyle(0xe6d7a8, 1);
    graphics.fillTriangle(
      -headRadius * 2,
      headCenterY - headRadius * 0.4,
      headRadius * 2,
      headCenterY - headRadius * 0.4,
      0,
      headCenterY - headRadius * 2.6,
    );
    graphics.fillStyle(0xbfae82, 1);
    graphics.fillRect(-headRadius * 1.2, headCenterY - headRadius * 0.6, headRadius * 2.4, 2);
    graphics.fillStyle(0xf2f2f2, 1);
    graphics.fillRoundedRect(
      -headRadius * 0.5,
      headCenterY + headRadius * 0.35,
      headRadius,
      headRadius * 1.3,
      2,
    );
  }
}

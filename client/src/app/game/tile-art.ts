import Phaser from 'phaser';
import type { MonsterShape } from '@ninja/shared';
import { parseHexColor, type MapTile } from './world-logic';

/**
 * Vẽ gạch và nhân vật bằng hình khối sinh ra trong mã, **không dùng tài nguyên hình** nào.
 *
 * Dự án chưa có tài nguyên đồ họa (xem `assets/README.md`) và sẽ không sao chép tài nguyên của game
 * khác, nên bản M2 dựng hình ảnh từ hình khối. Mục tiêu là để bản đồ trông ra một thế giới chứ không
 * phải lưới ô màu: mỗi loại gạch có hoa văn riêng, **mép tiếp giáp giữa các loại địa hình được vẽ
 * theo ô bên cạnh** (cỏ vào đường đất, bờ nước, diềm mái, chân tường), và nhân vật có hình người.
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

/** Gạch quanh một ô trong **cùng lớp**, dùng để vẽ mép tiếp giáp. `-1` là ô trống hoặc ngoài biên. */
export interface TileNeighbourhood {
  readonly up: number;
  readonly down: number;
  readonly left: number;
  readonly right: number;
}

export const NO_NEIGHBOURS: TileNeighbourhood = { up: -1, down: -1, left: -1, right: -1 };

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
  neighbours: TileNeighbourhood = NO_NEIGHBOURS,
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
      drawPath(graphics, x, y, size, col, row, color, neighbours, ground);
      break;
    case TILE_WATER:
      drawWater(graphics, x, y, size, col, row, color, neighbours, ground);
      break;
    case TILE_SAND:
      drawSand(graphics, x, y, size, col, row, color, neighbours, ground);
      break;
    case TILE_WALL:
      drawWall(graphics, x, y, size, col, row, color, neighbours, ground);
      break;
    case TILE_ROOF:
      drawRoof(graphics, x, y, size, col, row, color, neighbours, ground);
      break;
    case TILE_TREE:
      if (ground) {
        drawGrass(graphics, x, y, size, col, row, color);
      }
      drawContactShadow(graphics, x + size / 2, y + size * 0.72, size * 0.62, size * 0.24);
      drawTree(graphics, x, y, size, color);
      break;
    case TILE_ROCK:
      if (ground) {
        drawGrass(graphics, x, y, size, col, row, color);
      }
      drawContactShadow(graphics, x + size / 2, y + size * 0.74, size * 0.5, size * 0.2);
      drawRock(graphics, x, y, size, color, col, row);
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

/** Bóng mờ dưới vật thể: cho thấy vật thể nằm **trên** mặt đất chứ không dán vào nền. */
function drawContactShadow(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  graphics.fillStyle(0x000000, 0.2);
  graphics.fillEllipse(cx, cy, w, h);
}

/**
 * Vẽ một hình "có mép lởm chởm" theo từng cột: mỗi cột 1 px cao lên/xuống theo ô bên cạnh.
 *
 * Dùng để nối hai loại địa hình mà không cần tài nguyên hình: mép tiếp giáp thẳng đứng của lưới ô
 * được thay bằng mép hơi nhấp nhô, nên cỏ vào đường đất hay bờ nước trông tự nhiên hơn hẳn.
 */
function fillWavy(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  edgeTop: boolean,
  edgeBottom: boolean,
  edgeLeft: boolean,
  edgeRight: boolean,
  salt: number,
): void {
  graphics.fillStyle(color, 1);
  for (let dx = 0; dx < size; dx += 1) {
    // Mép trên/dưới của **cột này** bị lấn vào bao nhiêu px (chỉ khi cột này nằm ở mép ngoài).
    const nearLeft = edgeLeft && dx < 4;
    const nearRight = edgeRight && dx >= size - 4;
    const bumpTop =
      edgeTop && (nearLeft || nearRight || rand01(col * size + dx, row, salt) < 0.45) ? 1 : 0;
    const topInset = edgeTop ? Math.round(rand01(col, row * 31 + dx, salt) * 2) + bumpTop : 0;
    const bottomInset = edgeBottom
      ? Math.round(rand01(col, row * 31 + dx, salt + 7) * 2) +
        (rand01(col, dx + row, salt + 3) < 0.35 ? 1 : 0)
      : 0;
    const height = size - topInset - bottomInset;
    if (height <= 0) {
      continue;
    }
    graphics.fillRect(x + dx, y + topInset, 1, height);
  }
}

// ------------------------------------------------------------------ từng loại gạch

/** Cỏ: nền xanh + nhánh cỏ, thỉnh thoảng có hoa và mảng tối. */
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

  // Mảng cỏ tối hơn: phá thế phẳng đều của cả cánh đồng.
  if (rand01(col, row, 991) < 0.22) {
    graphics.fillStyle(shade(color, -0.045), 1);
    const px = x + rand01(col, row, 992) * size * 0.5;
    const py = y + rand01(col, row, 993) * size * 0.5;
    graphics.fillEllipse(px, py, size * 0.9, size * 0.6);
  }

  const lighter = shade(color, 0.07);
  const darker = shade(color, -0.07);
  for (let i = 0; i < 10; i += 1) {
    const bx = x + 2 + rand01(col, row, i * 3) * (size - 4);
    const by = y + 2 + rand01(col, row, i * 3 + 1) * (size - 4);
    const tall = rand01(col, row, i * 3 + 2) > 0.5 ? 3 : 2;
    graphics.fillStyle(rand01(col, row, i * 3 + 2) > 0.5 ? lighter : darker, 1);
    graphics.fillRect(bx, by, 1, tall);
  }

  // Hoa: rất thưa, để cánh đồng có điểm nhấn mà không rối.
  if (rand01(col, row, 77) < 0.07) {
    const fx = x + 5 + rand01(col, row, 78) * (size - 10);
    const fy = y + 5 + rand01(col, row, 79) * (size - 10);
    const petal = rand01(col, row, 80) < 0.5 ? 0xf6f0a8 : 0xe8a9c8;
    graphics.fillStyle(petal, 1);
    graphics.fillRect(fx, fy, 2, 2);
    graphics.fillRect(fx - 2, fy, 2, 2);
    graphics.fillRect(fx, fy - 2, 2, 2);
    graphics.fillRect(fx + 2, fy, 2, 2);
    graphics.fillStyle(0xf0d060, 1);
    graphics.fillRect(fx, fy, 1, 1);
  }
}

/** Đường đất: cỏ ở dưới rồi tới đất có mép lởm chởm, thêm sỏi và vệt bánh xe. */
function drawPath(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  n: TileNeighbourhood,
  ground: boolean,
): void {
  if (ground) {
    drawGrass(graphics, x, y, size, col, row, 0x2f5d3a);
  }
  fillWavy(
    graphics,
    x,
    y,
    size,
    col,
    row,
    color,
    n.up !== TILE_PATH,
    n.down !== TILE_PATH,
    n.left !== TILE_PATH,
    n.right !== TILE_PATH,
    21,
  );

  // Vệt sáng ở giữa đường: đường mòn do người đi nhiều.
  graphics.fillStyle(shade(color, 0.05), 0.5);
  graphics.fillEllipse(x + size / 2, y + size / 2, size * 0.8, size * 0.66);

  const light = shade(color, 0.09);
  const dark = shade(color, -0.1);
  for (let i = 0; i < 5; i += 1) {
    const px = x + 5 + rand01(col, row, i * 5 + 1) * (size - 10);
    const py = y + 5 + rand01(col, row, i * 5 + 2) * (size - 10);
    graphics.fillStyle(rand01(col, row, i * 5 + 3) > 0.45 ? light : dark, 1);
    graphics.fillEllipse(px, py, 3, 2);
  }
}

/** Nước: cát ở dưới rồi tới nước có bờ lởm chởm, gợn sóng và vùng sâu tối hơn. */
function drawWater(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  n: TileNeighbourhood,
  ground: boolean,
): void {
  const shoreTop = n.up !== TILE_WATER;
  const shoreBottom = n.down !== TILE_WATER;
  const shoreLeft = n.left !== TILE_WATER;
  const shoreRight = n.right !== TILE_WATER;

  if (ground) {
    // Bờ: cát quanh hồ, rồi nước lấn vào.
    graphics.fillStyle(0xb9a06a, 1);
    graphics.fillRect(x, y, size, size);
  }

  fillWavy(graphics, x, y, size, col, row, color, shoreTop, shoreBottom, shoreLeft, shoreRight, 33);

  // Vùng nước sâu: tối hơn ở giữa ô, làm mặt hồ có chiều sâu.
  if (!shoreTop && !shoreBottom && !shoreLeft && !shoreRight) {
    graphics.fillStyle(shade(color, -0.05), 0.45);
    graphics.fillEllipse(x + size / 2, y + size / 2, size * 0.86, size * 0.86);
  }

  const foam = shade(color, 0.2);
  const gy = y + size * 0.5;
  graphics.fillStyle(foam, shoreTop || shoreBottom ? 0.65 : 0.45);
  const wx = x + 3 + rand01(col, row, 50) * 7;
  graphics.fillRect(wx, gy, size - 8 - rand01(col, row, 60) * 5, 1);
  graphics.fillRect(wx + 3, gy + 3, Math.max(2, size - 12), 1);

  // Bọt trắng men theo bờ.
  graphics.fillStyle(0xdff0f5, 0.5);
  if (shoreTop) {
    graphics.fillRect(x + 3, y + 1, size - 6, 1);
  }
  if (shoreBottom) {
    graphics.fillRect(x + 4, y + size - 2, size - 8, 1);
  }
  if (shoreLeft) {
    graphics.fillRect(x + 1, y + 3, 1, size - 6);
  }
  if (shoreRight) {
    graphics.fillRect(x + size - 2, y + 4, 1, size - 8);
  }
}

/** Cát: cỏ ở ngoài, cát có mép lởm chởm, hạt sạn và vài viên sỏi. */
function drawSand(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  n: TileNeighbourhood,
  ground: boolean,
): void {
  const touchesWater =
    n.up === TILE_WATER || n.down === TILE_WATER || n.left === TILE_WATER || n.right === TILE_WATER;

  if (ground) {
    if (
      n.up === TILE_SAND ||
      n.down === TILE_SAND ||
      n.left === TILE_SAND ||
      n.right === TILE_SAND
    ) {
      graphics.fillStyle(0xb9a06a, 1);
      graphics.fillRect(x, y, size, size);
    } else {
      drawGrass(graphics, x, y, size, col, row, 0x2f5d3a);
    }
  }
  fillWavy(
    graphics,
    x,
    y,
    size,
    col,
    row,
    color,
    !touchesWater && n.up !== TILE_SAND,
    !touchesWater && n.down !== TILE_SAND,
    !touchesWater && n.left !== TILE_SAND,
    !touchesWater && n.right !== TILE_SAND,
    44,
  );

  const dark = shade(color, -0.08);
  for (let i = 0; i < 8; i += 1) {
    const px = x + 2 + rand01(col, row, i * 7 + 2) * (size - 4);
    const py = y + 2 + rand01(col, row, i * 7 + 3) * (size - 4);
    graphics.fillStyle(dark, 0.7);
    graphics.fillRect(px, py, 1, 1);
  }
  if (rand01(col, row, 88) < 0.18) {
    graphics.fillStyle(shade(color, -0.14), 1);
    graphics.fillEllipse(
      x + 8 + rand01(col, row, 89) * (size - 16),
      y + 8 + rand01(col, row, 90) * (size - 16),
      4,
      3,
    );
  }
}

/**
 * Tường: gạch xây so le, **mạch vữa chạy ngang suốt cả bức tường** (không ngắt ở mỗi ô), mép trên
 * sáng vì hứng nắng, mép dưới tối, và thỉnh thoảng có cửa sổ.
 */
function drawWall(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  n: TileNeighbourhood,
  ground: boolean,
): void {
  const brick = shade(color, 0.05);
  const brickAlt = shade(color, -0.02);
  const mortar = shade(color, -0.18);
  const rowHeight = Math.max(7, Math.round(size / 4));

  if (ground) {
    graphics.fillStyle(mortar, 1);
    graphics.fillRect(x, y, size, size);
  }

  // Mạch vữa ngang liên tục: cùng một chu kỳ hàng cho mọi ô nên trông là một bức tường dài.
  for (let r = 0; r * rowHeight < size; r += 1) {
    const by = y + r * rowHeight;
    const offset = (row % 2 === 0 ? 0 : 1) + Math.round(size / 4);
    for (let bx = x - offset; bx < x + size; bx += Math.round(size / 2)) {
      const left = Math.max(x, bx + 1);
      const right = Math.min(x + size - 1, bx + Math.round(size / 2) - 1);
      if (right <= left) {
        continue;
      }
      graphics.fillStyle((row + r) % 2 === 0 ? brick : brickAlt, 1);
      graphics.fillRect(left, by + 1, right - left, rowHeight - 2);
    }
  }

  if (n.up !== TILE_WALL) {
    graphics.fillStyle(shade(color, 0.16), 1);
    graphics.fillRect(x, y, size, 2);
    graphics.fillStyle(shade(color, 0.08), 0.8);
    graphics.fillRect(x, y + 2, size, 1);
  }
  if (n.down !== TILE_WALL) {
    graphics.fillStyle(0x000000, 0.28);
    graphics.fillRect(x, y + size - 3, size, 3);
  }
  if (n.left !== TILE_WALL) {
    graphics.fillStyle(shade(color, -0.1), 1);
    graphics.fillRect(x, y, 1, size);
  }
  if (n.right !== TILE_WALL) {
    graphics.fillStyle(shade(color, -0.1), 1);
    graphics.fillRect(x + size - 1, y, 1, size);
  }

  // Cửa sổ: thưa, và chỉ ở ô không kề mép nào để không đè lên góc tường.
  const interior =
    n.up === TILE_WALL && n.down === TILE_WALL && n.left === TILE_WALL && n.right === TILE_WALL;
  if (interior && rand01(col, row, 123) < 0.12) {
    const ww = Math.round(size * 0.5);
    const wh = Math.round(size * 0.42);
    const wx = x + (size - ww) / 2;
    const wy = y + Math.round(size * 0.26);
    graphics.fillStyle(0x2a1a10, 1);
    graphics.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
    graphics.fillStyle(0x6fa8c8, 1);
    graphics.fillRect(wx, wy, ww, wh);
    graphics.fillStyle(0xdfeef7, 0.55);
    graphics.fillRect(wx, wy, ww, Math.max(1, Math.round(wh / 3)));
    graphics.fillStyle(0x2a1a10, 1);
    graphics.fillRect(wx + Math.round(ww / 2) - 1, wy, 2, wh);
    graphics.fillRect(wx, wy + Math.round(wh / 2) - 1, ww, 2);
  }
}

/**
 * Mái nhà: hàng ngói chạy liên tục, **nóc sáng ở hàng trên cùng** và **diềm tối ở hàng dưới cùng**
 * của cả mái (tính theo ô bên cạnh), nên cả khối mái đọc ra một mái nhà chứ không phải lưới ô.
 */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  col: number,
  row: number,
  color: number,
  n: TileNeighbourhood,
  ground: boolean,
): void {
  const base = ground ? color : shade(color, -0.04);
  const rowHeight = Math.max(7, Math.round(size / 3));
  const shadow = shade(color, -0.14);

  graphics.fillStyle(base, 1);
  graphics.fillRect(x, y, size, size);

  for (let r = 0; r * rowHeight < size; r += 1) {
    const by = y + r * rowHeight;
    graphics.fillStyle(r % 2 === 0 ? shade(base, 0.04) : shade(base, -0.02), 1);
    graphics.fillRect(x, by, size, rowHeight - 1);
    graphics.fillStyle(shadow, 0.75);
    graphics.fillRect(x, by + rowHeight - 2, size, 2);
    // Vảy ngói: lệch nửa viên giữa hai hàng cho ra hoa văn đều.
    for (let bx = x + (r % 2 === 0 ? 0 : 4); bx < x + size; bx += 8) {
      graphics.fillStyle(shadow, 0.3);
      graphics.fillRect(bx, by + 2, 1, rowHeight - 5);
      graphics.fillStyle(shade(base, 0.08), 0.35);
      graphics.fillRect(bx + 1, by + 2, 4, 1);
    }
  }

  if (n.up !== TILE_ROOF) {
    // Nóc: hai dải sáng + một vệt tối ngay dưới để thấy độ dày của mái.
    graphics.fillStyle(shade(color, 0.28), 1);
    graphics.fillRect(x, y, size, 3);
    graphics.fillStyle(shade(color, 0.12), 1);
    graphics.fillRect(x, y + 3, size, 2);
    graphics.fillStyle(0x000000, 0.18);
    graphics.fillRect(x, y + 5, size, 1);
  }
  if (n.down !== TILE_ROOF) {
    // Diềm mái: tối hơn và nhô ra 2 px để mái có bóng đổ xuống tường.
    graphics.fillStyle(0x000000, 0.3);
    graphics.fillRect(x, y + size - 4, size, 4);
    graphics.fillStyle(shade(color, 0.06), 1);
    graphics.fillRect(x, y + size - 6, size, 2);
  }
  if (n.left !== TILE_ROOF) {
    graphics.fillStyle(shade(color, -0.16), 0.9);
    graphics.fillRect(x, y, 2, size);
  }
  if (n.right !== TILE_ROOF) {
    graphics.fillStyle(shade(color, -0.16), 0.9);
    graphics.fillRect(x + size - 2, y, 2, size);
  }
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
  const base = y + size - 3;
  graphics.fillStyle(0x3d2a19, 1);
  graphics.fillRect(cx - 2, base - size * 0.35, 4, size * 0.35);

  const dark = shade(color, -0.07);
  const mid = shade(color, 0.03);
  const light = shade(color, 0.15);
  graphics.fillStyle(dark, 1);
  graphics.fillCircle(cx, y + size * 0.42, size * 0.34);
  graphics.fillCircle(cx - size * 0.24, y + size * 0.55, size * 0.24);
  graphics.fillCircle(cx + size * 0.24, y + size * 0.54, size * 0.24);
  graphics.fillStyle(mid, 1);
  graphics.fillCircle(cx - 1, y + size * 0.4, size * 0.27);
  graphics.fillStyle(light, 0.9);
  graphics.fillCircle(cx - size * 0.13, y + size * 0.31, size * 0.14);
  graphics.fillStyle(shade(color, 0.22), 0.5);
  graphics.fillCircle(cx - size * 0.2, y + size * 0.26, size * 0.06);
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
  const bottom = y + size * 0.8;
  const top = y + size * 0.3;
  graphics.fillStyle(shade(color, -0.1), 1);
  graphics.fillTriangle(cx - w / 2, bottom, cx + w / 2, bottom, cx, top);
  graphics.fillStyle(color, 1);
  graphics.fillTriangle(cx - w / 2 + 3, bottom - 2, cx + w / 2 - 3, bottom - 2, cx, top + 3);
  graphics.fillStyle(shade(color, 0.16), 1);
  graphics.fillTriangle(cx - w / 4, bottom - 5, cx, bottom - 5, cx - 2, top + 7);
}

/** Hàng rào: hai thanh ngang + cột, đi được (chỉ để trang trí). */
function drawFence(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
): void {
  const rail = shade(color, 0.1);
  const post = shade(color, -0.06);
  const top = y + size * 0.42;
  const bottom = y + size * 0.74;
  graphics.fillStyle(0x000000, 0.18);
  graphics.fillRect(x, bottom + 4, size, 2);
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
  graphics.fillStyle(0x000000, 0.24);
  graphics.fillEllipse(0, feetY + 1, bodyWidth + 6, 6 * scale);

  if (art.highlight) {
    graphics.fillStyle(0x7fd1ff, 0.18);
    graphics.fillEllipse(0, feetY + 1, bodyWidth + 18, 12 * scale);
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
  // Cổ áo sáng: cùng một chi tiết nhỏ làm hình đọc ra "bộ đồng phục".
  graphics.fillStyle(shade(torso, 0.22), 1);
  graphics.fillRect(-Math.round(3 * scale), bodyTop + 1, Math.round(6 * scale), 2);

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
    graphics.fillStyle(shade(HAIR, 0.12), 1);
    graphics.fillCircle(0, headCenterY + 1.5, headRadius * 0.7);
  } else {
    graphics.fillStyle(HAIR, 1);
    graphics.fillCircle(0, headCenterY - headRadius * 0.55, headRadius * 0.95);
    graphics.fillStyle(SKIN_SHADOW, 0.45);
    graphics.fillCircle(0, headCenterY + headRadius * 0.45, headRadius * 0.55);
  }

  // Băng đô mang màu của trường/phái: dấu nhận biết chính của nhân vật ninja.
  const bandHeight = Math.max(2, Math.round(2.6 * scale));
  graphics.fillStyle(0xd8443f, 1);
  graphics.fillRect(-headRadius, headCenterY - headRadius * 0.85, headRadius * 2, bandHeight);
  graphics.fillStyle(0xa8322e, 1);
  graphics.fillRect(
    -headRadius,
    headCenterY - headRadius * 0.85 + bandHeight - 1,
    headRadius * 2,
    1,
  );
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

// ------------------------------------------------------------------- quái

/** Hình dáng quái để vẽ; dữ liệu quái chọn hình dáng, không chứa cách vẽ. */
export interface MonsterArt {
  readonly shape: MonsterShape;
  readonly color: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly height: number;
}

/** Màu phụ trợ của quái: cọc rơm, đuôi, nanh — màu chính lấy từ dữ liệu quái. */
const MONSTER_POLE = 0x6b4a2f;
const MONSTER_STRAW = 0xd9c07a;
const MONSTER_DARK = 0x2a2118;
const MONSTER_TOOTH = 0xf2ead6;

/**
 * Vẽ một con quái bằng hình khối: mỗi hình dáng có thân, đầu và chi tiết riêng để nhìn là biết
 * đang đánh con gì. Quái đã chết được vẽ mờ và có thanh máu rỗng — xác vẫn nằm đó tới lúc hồi sinh.
 */
export function drawMonster(graphics: Phaser.GameObjects.Graphics, art: MonsterArt): void {
  const { color, height } = art;
  const alpha = art.alive && art.hp > 0 ? 1 : 0.35;
  const bodyRadius = height * 0.34;
  const headRadius = height * 0.22;

  switch (art.shape) {
    case 'scarecrow': {
      // Bù nhìn: cọc gỗ, thân rơm, hai tay ngang và vành nón.
      graphics.fillStyle(MONSTER_POLE, alpha);
      graphics.fillRect(-2, -height * 0.5, 4, height);
      graphics.fillStyle(color, alpha);
      graphics.fillEllipse(0, height * 0.02, bodyRadius * 2.1, bodyRadius * 2.4);
      graphics.fillStyle(MONSTER_STRAW, alpha);
      graphics.fillRect(-bodyRadius * 1.5, -height * 0.12, bodyRadius * 3, 4);
      graphics.fillRect(-2, height * 0.34, -bodyRadius, 3);
      graphics.fillStyle(MONSTER_STRAW, alpha);
      graphics.fillTriangle(
        -headRadius * 1.5,
        -height * 0.3,
        headRadius * 1.5,
        -height * 0.3,
        0,
        -height * 0.5,
      );
      graphics.fillStyle(color, alpha);
      graphics.fillCircle(0, -height * 0.3, headRadius);
      graphics.fillStyle(MONSTER_DARK, alpha);
      graphics.fillRect(-headRadius * 0.6, -height * 0.32, 3, 3);
      graphics.fillRect(headRadius * 0.2, -height * 0.32, 3, 3);
      break;
    }
    case 'rodent': {
      // Chuột: thân bầu, tai tròn, mõm nhọn và đuôi dài.
      graphics.fillStyle(MONSTER_DARK, alpha);
      graphics.fillRect(-bodyRadius * 1.2, height * 0.32, bodyRadius, 3);
      graphics.fillRect(bodyRadius * 0.2, height * 0.32, bodyRadius, 3);
      graphics.lineStyle(3, MONSTER_DARK, alpha);
      graphics.beginPath();
      graphics.moveTo(-bodyRadius * 0.9, height * 0.05);
      graphics.lineTo(-bodyRadius * 2.2, -height * 0.1);
      graphics.lineTo(-bodyRadius * 1.6, -height * 0.32);
      graphics.strokePath();
      graphics.fillStyle(color, alpha);
      graphics.fillEllipse(0, height * 0.08, bodyRadius * 2.2, bodyRadius * 1.7);
      graphics.fillTriangle(
        bodyRadius * 0.6,
        -height * 0.02,
        bodyRadius * 1.9,
        height * 0.06,
        bodyRadius * 0.7,
        height * 0.2,
      );
      graphics.fillCircle(-bodyRadius * 0.5, -height * 0.3, headRadius * 0.75);
      graphics.fillCircle(bodyRadius * 0.35, -height * 0.3, headRadius * 0.75);
      graphics.fillStyle(MONSTER_DARK, alpha);
      graphics.fillCircle(bodyRadius * 1.7, height * 0.05, 2);
      graphics.fillStyle(MONSTER_TOOTH, alpha);
      graphics.fillRect(bodyRadius * 1.25, height * 0.1, 4, 3);
      break;
    }
    case 'beast': {
      // Thú: thân to, chân ngắn, mõm nhọn và hai nanh.
      graphics.fillStyle(MONSTER_DARK, alpha);
      graphics.fillRect(-bodyRadius * 1.35, height * 0.3, bodyRadius * 0.7, height * 0.18);
      graphics.fillRect(bodyRadius * 0.65, height * 0.3, bodyRadius * 0.7, height * 0.18);
      graphics.fillStyle(color, alpha);
      graphics.fillEllipse(0, height * 0.05, bodyRadius * 2.9, bodyRadius * 2.1);
      graphics.fillTriangle(
        bodyRadius * 0.9,
        -height * 0.08,
        bodyRadius * 1.9,
        height * 0.12,
        bodyRadius * 0.95,
        height * 0.3,
      );
      graphics.fillStyle(color, alpha);
      graphics.fillCircle(-bodyRadius * 0.85, -height * 0.28, headRadius);
      graphics.fillTriangle(
        -bodyRadius * 1.2,
        -height * 0.34,
        -bodyRadius * 0.6,
        -height * 0.34,
        -bodyRadius * 0.9,
        -height * 0.5,
      );
      graphics.fillStyle(MONSTER_TOOTH, alpha);
      graphics.fillTriangle(
        bodyRadius * 1.5,
        height * 0.16,
        bodyRadius * 1.8,
        height * 0.16,
        bodyRadius * 1.55,
        height * 0.02,
      );
      graphics.fillStyle(MONSTER_DARK, alpha);
      graphics.fillCircle(bodyRadius * 1.5, height * 0.02, 2.5);
      break;
    }
  }

  drawMonsterHealthBar(graphics, art);
}

/** Thanh máu nhỏ trên đầu quái: chỉ hiện khi đã mất máu, để bản đồ không đầy thanh trang trí. */
function drawMonsterHealthBar(graphics: Phaser.GameObjects.Graphics, art: MonsterArt): void {
  if (art.alive && art.hp >= art.maxHp) {
    return;
  }
  const width = 30;
  const height = 4;
  const top = -art.height * 0.62;
  const ratio = art.maxHp > 0 ? Math.max(0, Math.min(1, art.hp / art.maxHp)) : 0;

  graphics.fillStyle(0x101820, 0.85);
  graphics.fillRect(-width / 2, top, width, height);
  if (ratio > 0) {
    graphics.fillStyle(ratio > 0.5 ? 0x6cc36c : ratio > 0.25 ? 0xd9b64a : 0xc05757, 1);
    graphics.fillRect(-width / 2 + 1, top + 1, (width - 2) * ratio, height - 2);
  }
}

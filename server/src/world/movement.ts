import { MAX_MOVE_DISTANCE_PX, PLAYER_SPEED_PX_PER_SEC, TICK_RATE_MS } from '@ninja/shared';
import type { MapInstance, Position } from './map.js';

/**
 * Hướng đi gửi cho client vẽ hoạt ảnh. Hợp đồng mạng chỉ khai báo union này ngay trong
 * `EntityMoveSchema` (không xuất ra thành kiểu dùng lại được), nên server định nghĩa lại ở đây
 * và giữ đúng thứ tự/giá trị của union đó.
 */
export const FACINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'none'] as const;
export type Facing = (typeof FACINGS)[number];

/** Quãng đường đi được trong một nhịp tick (pixel). */
export const MOVE_STEP_PX = (PLAYER_SPEED_PX_PER_SEC * TICK_RATE_MS) / 1000;

/** Sai số cho phép để coi là đã tới đích (pixel). */
export const ARRIVE_EPSILON_PX = 0.5;

/** Lý do từ chối một lệnh di chuyển. */
export type MoveRejection = 'too_far' | 'out_of_bounds' | 'blocked';

/** Thông báo tiếng Việt cho từng lý do (mã lỗi vẫn là `bad_packet`, không fatal). */
export const MOVE_REJECTION_MESSAGES: Record<MoveRejection, string> = {
  too_far: `một lệnh chỉ được di chuyển tối đa ${MAX_MOVE_DISTANCE_PX} px`,
  out_of_bounds: 'điểm đến nằm ngoài bản đồ',
  blocked: 'điểm đến nằm trong ô bị chặn (nước, tường, cây...)',
};

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Kiểm tra một lệnh di chuyển của client. Chỉ kiểm **điểm đích** (không kiểm đường đi) vì client
 * tự vẽ đường đi, còn server chỉ cần chặn dịch chuyển tức thời và xuyên vật cản.
 *
 * Trả về lý do từ chối, hoặc `undefined` nếu lệnh hợp lệ.
 */
export function checkMove(
  map: MapInstance,
  from: Position,
  to: Position,
): MoveRejection | undefined {
  if (distance(from.x, from.y, to.x, to.y) > MAX_MOVE_DISTANCE_PX) {
    return 'too_far';
  }
  if (!map.contains(to.x, to.y)) {
    return 'out_of_bounds';
  }
  if (map.isBlockedAt(to.x, to.y)) {
    return 'blocked';
  }
  return undefined;
}

export interface StepResult {
  readonly x: number;
  readonly y: number;
  /** Đã tới đích (hoặc đủ gần) — người chơi dừng ở đây. */
  readonly arrived: boolean;
}

/** Vị trí sau một bước đi về phía đích, tối đa `maxStep` pixel. */
export function stepTowards(from: Position, to: Position, maxStep = MOVE_STEP_PX): StepResult {
  const remaining = distance(from.x, from.y, to.x, to.y);
  if (remaining <= maxStep) {
    // Tới nơi: đặt đúng toạ độ đích, sai số bằng 0.
    return { x: to.x, y: to.y, arrived: true };
  }
  const ratio = maxStep / remaining;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
    arrived: false,
  };
}

/** Hướng 8 chiều của một bước đi; `none` khi không dịch chuyển. Trục y hướng xuống. */
export function facingFor(dx: number, dy: number): Facing {
  if (dx === 0 && dy === 0) {
    return 'none';
  }
  const byAngle: readonly Facing[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  const index = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return byAngle[((index % 8) + 8) % 8];
}

/** Làm tròn toạ độ trước khi gửi (2 chữ số thập phân) để gói tin gọn và dễ đọc. */
export function roundPosition(value: number): number {
  return Math.round(value * 100) / 100;
}

import { PLAYER_SPEED_PX_PER_SEC } from '@ninja/shared';
import { facingForVector, type Point } from '../game/world-logic';
import type { Facing } from '../net/world-types';
import { directionForKey, vectorForDirections, type ArrowDirection } from './key-map';

/**
 * Giãn cách tối thiểu giữa hai lệnh `C2S_MOVE`: 10 lệnh/giây. Đây cũng là nhịp lặp lại khi
 * người chơi giữ phím, nên vừa đủ mượt mà không tự làm mình bị server chặn vì gửi quá dày.
 */
export const MOVE_COMMAND_INTERVAL_MS = 100;

/** Nhịp bàn phím gửi đích xa hơn vị trí hiện tại hai nhịp đi, để không bị hụt bước. */
export const MOVE_LEAD_PX =
  ((PLAYER_SPEED_PX_PER_SEC * MOVE_COMMAND_INTERVAL_MS) / 1000) * 2;

/**
 * Bộ điều khiển di chuyển: gom phím đang giữ và đích do bấm chuột thành **ý định**, rồi gửi
 * `C2S_MOVE` theo nhịp cố định — không gửi mỗi khung hình, và không bao giờ vượt
 * `MOVE_COMMAND_INTERVAL_MS` giữa hai lệnh.
 *
 * Lớp này không chạm DOM và không biết tới WebSocket: `tick(now, self)` nhận thời gian và vị
 * trí hiện tại từ bên ngoài nên kiểm thử được bằng thời gian giả.
 */
export class MovementController {
  private readonly held = new Map<string, ArrowDirection>();
  private pending: Point | null = null;
  private stopRequested = false;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly send: (destination: Point) => void,
    private readonly intervalMs: number = MOVE_COMMAND_INTERVAL_MS,
    private readonly leadPx: number = MOVE_LEAD_PX,
  ) {}

  /** Bắt đầu giữ một phím; trả về `true` nếu đó là phím di chuyển. */
  press(key: string): boolean {
    const direction = directionForKey(key);
    if (!direction) {
      return false;
    }
    this.held.set(key, direction);
    // Đang giữ phím thì ý định bấm chuột trước đó bị bỏ: bàn phím là ý định mới nhất.
    this.pending = null;
    this.stopRequested = false;
    return true;
  }

  /** Nhả một phím; trả về `true` nếu đó là phím di chuyển. */
  release(key: string): boolean {
    const direction = directionForKey(key);
    if (!direction) {
      return false;
    }
    this.held.delete(key);
    if (this.held.size === 0) {
      // Vừa ngừng hẳn: gửi lệnh dừng để server không đi tiếp tới đích cũ.
      this.stopRequested = true;
    }
    return true;
  }

  /** Bấm/chạm vào bản đồ: đi tới điểm này (chờ tới nhịp gửi nếu đang bị giới hạn). */
  requestDestination(destination: Point): void {
    this.pending = destination;
    this.stopRequested = false;
  }

  /** Hướng đang giữ, dùng để vẽ nhân vật quay đúng hướng ngay khi bấm phím. */
  facing(): Facing {
    return facingForVector(vectorForDirections(this.held.values()));
  }

  get moving(): boolean {
    return this.held.size > 0;
  }

  /**
   * Nhịp cập nhật: gửi lệnh di chuyển nếu có ý định mới và đã đủ giãn cách.
   * Trả về đích vừa gửi (dùng cho kiểm thử và gỡ lỗi), `null` nếu không gửi gì.
   */
  tick(now: number, self: Point | null): Point | null {
    if (self === null) {
      return null;
    }

    if (this.moving) {
      const vector = vectorForDirections(this.held.values());
      if (vector.x === 0 && vector.y === 0) {
        return null;
      }
      if (!this.acquire(now)) {
        return null;
      }
      const destination = {
        x: self.x + vector.x * this.leadPx,
        y: self.y + vector.y * this.leadPx,
      };
      this.send(destination);
      return destination;
    }

    if (this.pending) {
      if (!this.acquire(now)) {
        return null;
      }
      const destination = this.pending;
      this.pending = null;
      this.send(destination);
      return destination;
    }

    if (this.stopRequested) {
      if (!this.acquire(now)) {
        return null;
      }
      this.stopRequested = false;
      const destination = { x: self.x, y: self.y };
      this.send(destination);
      return destination;
    }

    return null;
  }

  /** Quên hết trạng thái (mất kết nối, rời trang). */
  reset(): void {
    this.held.clear();
    this.pending = null;
    this.stopRequested = false;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
  }

  private acquire(now: number): boolean {
    if (now - this.lastSentAt < this.intervalMs) {
      return false;
    }
    this.lastSentAt = now;
    return true;
  }
}

import { TICK_RATE_MS } from '@ninja/shared';

export type TickListener = (now: number) => void;

/**
 * Nhịp sống của thế giới: **một** `setInterval` dùng chung cho cả server (10 Hz theo
 * `TICK_RATE_MS`). Các phần khác (room, kiểm tra heartbeat) đăng ký nhận nhịp thay vì tự mở
 * interval riêng, để mọi thứ cập nhật cùng một thời điểm và chỉ tốn một timer.
 */
export class TickScheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<TickListener>();

  constructor(readonly intervalMs: number = TICK_RATE_MS) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Đăng ký nhận nhịp; gọi hàm trả về để huỷ đăng ký. */
  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Bắt đầu chạy nhịp. Gọi nhiều lần cũng chỉ có một interval. */
  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const listener of [...this.listeners]) {
        listener(now);
      }
    }, this.intervalMs);
    // Nhịp không giữ tiến trình sống: khi server đóng, tiến trình phải thoát được ngay.
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Dừng nhịp và quên mọi listener (gọi khi đóng app). */
  dispose(): void {
    this.stop();
    this.listeners.clear();
  }
}

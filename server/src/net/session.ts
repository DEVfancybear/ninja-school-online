import type { ErrorCode } from '@ninja/shared';

/**
 * Hợp đồng tối thiểu mà tầng thế giới (`world/`) cần ở một kết nối.
 *
 * Tách khỏi lớp `ClientSession` để `world/` chỉ phải import **kiểu** từ `net/`, không phụ thuộc
 * vòng khi chạy (net → world → net).
 */
export interface GameSession {
  /** Mã kết nối, dùng cho log và truy vết. */
  readonly connectionId: string;
  /** Nhân vật đang điều khiển kết nối; `undefined` khi chưa bắt tay xong. */
  characterId: string | undefined;
  /** Bản đồ hiện tại; `undefined` khi chưa vào thế giới. */
  mapId: string | undefined;
  /** Kết nối đã đóng: thế giới không được thêm thực thể cho phiên này nữa. */
  readonly closed: boolean;
  /** Gửi một gói tin server → client. */
  send(op: number, payload: unknown): void;
  /** Gửi lỗi ở mức kết nối; `fatal` nghĩa là server đóng kết nối sau khi gửi. */
  sendError(code: ErrorCode, message: string, fatal?: boolean): void;
  /** Báo cho client biết phiên này bị thay thế rồi đóng kết nối (cùng nhân vật đăng nhập lại). */
  replacedByNewLogin(): void;
}

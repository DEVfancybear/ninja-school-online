import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ArenaEnd, ArenaState, LeaderboardEntry, LeaderboardKind } from '@ninja/shared';

/** Nhãn tiếng Việt của hai bảng xếp hạng, dùng chung cho nút thẻ và tiêu đề bảng. */
export const LEADERBOARD_LABELS: Readonly<Record<LeaderboardKind, string>> = {
  level: 'Cấp độ',
  arena: 'Lôi Đài',
};

/**
 * Bảng Lôi Đài: điểm và thành tích của mình, nút xếp hàng, và bảng xếp hạng hai loại.
 *
 * Component **không** gửi gói tin — nó phát ra ý định, `/play` dựng gói. Kết quả trận vừa xong
 * (`result`) do trang truyền vào và chỉ biến mất khi người chơi đóng nó hoặc đóng cả bảng, đúng như
 * hợp đồng: `S2C_ARENA_END` không kèm thời hạn hiển thị.
 */
@Component({
  selector: 'app-arena-panel',
  templateUrl: './arena-panel.html',
  styleUrl: './arena-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArenaPanel {
  readonly state = input.required<ArenaState>();
  /** Trận vừa xong; `null` khi không có gì để báo. */
  readonly result = input<ArenaEnd | null>(null);
  /** Bảng đang xem (lấy từ `S2C_LEADERBOARD` gần nhất). */
  readonly board = input<LeaderboardKind>('level');
  readonly entries = input<readonly LeaderboardEntry[]>([]);

  readonly queue = output<void>();
  /** Rời hàng chờ ghép trận. */
  readonly queueCancel = output<void>();
  readonly boardChange = output<LeaderboardKind>();
  readonly resultClosed = output<void>();
  readonly closed = output<void>();

  readonly labels = LEADERBOARD_LABELS;

  /** Bảng Lôi Đài mới có cột điểm; bảng cấp độ chỉ có cấp. */
  readonly showRating = computed(() => this.board() === 'arena');

  /** "Thắng"/"Thua" của trận vừa xong, đọc theo góc nhìn người nhận gói. */
  readonly resultTitle = computed(() => {
    const result = this.result();
    if (!result) {
      return '';
    }
    return result.outcome === 'win' ? 'Thắng' : 'Thua';
  });

  /** Điểm cộng/trừ có dấu, ví dụ `+16` hoặc `-16` (0 thì để `0`, không thêm dấu). */
  readonly resultDelta = computed(() => {
    const delta = this.result()?.ratingDelta ?? 0;
    return delta > 0 ? `+${delta}` : `${delta}`;
  });

  chooseBoard(board: LeaderboardKind): void {
    if (board !== this.board()) {
      this.boardChange.emit(board);
    }
  }
}

import { Injectable, computed, signal } from '@angular/core';
import {
  ARENA_START_RATING,
  LEADERBOARD_MAX_ENTRIES,
  Opcode,
  type ArenaEnd,
  type ArenaState as ArenaStatePayload,
  type LeaderboardEntry,
  type LeaderboardKind,
  type LeaderboardView,
} from '@ninja/shared';

/** Trạng thái Lôi Đài rỗng: chưa xếp hàng, điểm khởi đầu, chưa thắng thua trận nào. */
export function emptyArenaState(): ArenaStatePayload {
  return { queued: false, queueSize: 0, rating: ARENA_START_RATING, wins: 0, losses: 0 };
}

/**
 * Lôi Đài và bảng xếp hạng ở phía client.
 *
 * Ba mẩu dữ liệu sống chung một service vì cùng thuộc một bảng giao diện và cùng một vòng đời:
 * - `state`: `S2C_ARENA_STATE` — đang chờ ghép hay không, điểm, thắng/thua.
 * - `result`: `S2C_ARENA_END` — kết quả trận **vừa** xong. Giữ lại cho tới khi người chơi đóng
 *   bảng Lôi Đài (`closeResult()`), vì gói này tới đúng lúc khung chiến đấu vừa đóng và người chơi
 *   cần đọc được điểm mới thay vì thấy nó biến mất.
 * - `board` + `entries`: `S2C_LEADERBOARD` — bảng đang xem. Nhớ `board` là bắt buộc: gói trả về
 *   không kèm yêu cầu nào đang chờ, nên nếu không nhớ thì không biết đang vẽ bảng nào.
 *
 * Điểm sau trận cũng được cập nhật ngay từ `S2C_ARENA_END` (`ratingAfter`, `wins`, `losses`) để
 * bảng hiện điểm mới kể cả khi `S2C_ARENA_STATE` theo sau chậm một nhịp.
 */
@Injectable({ providedIn: 'root' })
export class ArenaState {
  private readonly stateSignal = signal<ArenaStatePayload>(emptyArenaState());
  private readonly resultSignal = signal<ArenaEnd | null>(null);
  private readonly boardSignal = signal<LeaderboardKind>('level');
  private readonly entriesSignal = signal<readonly LeaderboardEntry[]>([]);

  readonly state = this.stateSignal.asReadonly();
  readonly queued = computed(() => this.stateSignal().queued);
  readonly queueSize = computed(() => this.stateSignal().queueSize);
  readonly rating = computed(() => this.stateSignal().rating);
  readonly wins = computed(() => this.stateSignal().wins);
  readonly losses = computed(() => this.stateSignal().losses);

  /** Trận vừa xong; `null` khi chưa có trận nào hoặc người chơi đã đóng kết quả. */
  readonly result = this.resultSignal.asReadonly();
  /** Bảng đang xem — cũng là bảng `S2C_LEADERBOARD` gần nhất trả về. */
  readonly board = this.boardSignal.asReadonly();
  readonly entries = this.entriesSignal.asReadonly();

  /** Bảng rỗng vì máy chủ chưa có ai: giao diện hiện một dòng `--empty` thay vì bảng trắng. */
  readonly boardEmpty = computed(() => this.entriesSignal().length === 0);

  /**
   * Áp một gói server gửi xuống; trả về `false` nếu gói không thuộc phần Lôi Đài.
   *
   * `S2C_ARENA_END` cũng được `BattleState` xử lý (để đóng khung chiến đấu) — hai service độc lập
   * nhau, nên `play.ts` gọi cả hai chứ không để service này "đóng trận hộ" service kia.
   */
  applyPacket(op: number, payload: unknown): boolean {
    if (op === Opcode.S2C_ARENA_STATE) {
      this.stateSignal.set(payload as ArenaStatePayload);
      return true;
    }
    if (op === Opcode.S2C_ARENA_END) {
      const end = payload as ArenaEnd;
      this.resultSignal.set(end);
      // Điểm mới có ngay trong gói kết thúc; chờ `S2C_ARENA_STATE` là bảng hiện số cũ trong chốc lát.
      this.stateSignal.update((state) => ({
        ...state,
        queued: false,
        rating: end.ratingAfter,
        wins: end.wins,
        losses: end.losses,
      }));
      return true;
    }
    if (op === Opcode.S2C_LEADERBOARD) {
      const view = payload as LeaderboardView;
      this.boardSignal.set(view.board);
      this.entriesSignal.set(view.entries.slice(0, LEADERBOARD_MAX_ENTRIES));
      return true;
    }
    return false;
  }

  /** Người chơi đóng kết quả trận vừa xong (đóng bảng hoặc bấm nút đóng trong khung kết quả). */
  closeResult(): void {
    this.resultSignal.set(null);
  }

  /** Mất kết nối hoặc rời trang: bỏ trạng thái Lôi Đài của lần chơi trước. */
  reset(): void {
    this.stateSignal.set(emptyArenaState());
    this.resultSignal.set(null);
    this.boardSignal.set('level');
    this.entriesSignal.set([]);
  }
}

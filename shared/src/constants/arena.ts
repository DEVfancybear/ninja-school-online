/**
 * Lôi Đài 1v1 và bảng xếp hạng (M6). Công thức điểm nằm ở đây (không nằm trong server) để server
 * tính, kiểm thử và tài liệu cùng dẫn về **một** nguồn.
 */

import { BATTLE_TURN_MS } from './battle.js';

/**
 * Cấp tối thiểu để vào Lôi Đài. Chọn bằng cấp của nhiệm vụ cuối chương 1 (`quest-bai-su` đòi cấp 3):
 * người chơi mới phải đi hết chương 1 mới đủ sức, nhưng **không** bắt buộc đã trả nhiệm vụ đó —
 * cờ `arena` do nhiệm vụ mở khóa hiện chỉ để hiển thị.
 */
export const ARENA_MIN_LEVEL = 3;

/** Điểm khởi đầu của người chưa đấu trận Lôi Đài nào. */
export const ARENA_START_RATING = 1_000;

/** Điểm không bao giờ xuống dưới mức này, để thua nhiều vẫn còn động lực đấu tiếp. */
export const ARENA_RATING_FLOOR = 100;

/** Hệ số K của công thức Elo: giới hạn biên độ thay đổi mỗi trận trước khi áp dụng sàn điểm. */
export const ARENA_K_FACTOR = 32;

/** Mỗi lượt trong trận Lôi Đài dài bằng trận PvE; hết giờ thì server tự cho đánh thường. */
export const ARENA_TURN_MS = BATTLE_TURN_MS;

/** Số dòng tối đa của một bảng xếp hạng và số lần client được xin. */
export const LEADERBOARD_MAX_ENTRIES = 20;

/** Hai bảng xếp hạng của M6. */
export const LEADERBOARDS = ['level', 'arena'] as const;
export type LeaderboardKind = (typeof LEADERBOARDS)[number];

/** Số thư tối đa giữ trong hộp thư của một nhân vật. */
export const MAIL_MAX_ENTRIES = 20;

/**
 * Điểm kỳ vọng của người có `rating` khi đấu với người có `opponentRating` (Elo chuẩn, 0…1).
 * `0,5` nghĩa là hai bên ngang nhau.
 */
export function arenaExpectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/**
 * Điểm cộng/trừ của một trận Lôi Đài, làm tròn về số nguyên.
 *
 * Thắng người mạnh hơn được nhiều điểm hơn, thắng người yếu hơn được ít hơn; thua người yếu hơn mất
 * nhiều điểm hơn thua người mạnh hơn. Điểm không xuống dưới `ARENA_RATING_FLOOR`.
 */
export function arenaDelta(rating: number, opponentRating: number, won: boolean): number {
  const expected = arenaExpectedScore(rating, opponentRating);
  const raw = ARENA_K_FACTOR * ((won ? 1 : 0) - expected);
  const rounded = Math.round(Math.abs(raw));
  if (won) {
    return rounded;
  }
  // `-0` và `0` khác nhau khi so sánh nghiêm ngặt, nên trả thẳng `0` khi đã chạm sàn.
  const lost = Math.min(rounded, rating - ARENA_RATING_FLOOR);
  return lost === 0 ? 0 : -lost;
}

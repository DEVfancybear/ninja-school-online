import type { Character } from '@ninja/shared';

/**
 * Màu gửi kèm mỗi thực thể để client vẽ. Hợp đồng mạng (`EntitySchema`) bắt buộc có `color` nhưng
 * không nói màu lấy từ đâu, nên server chọn màu cố định theo trường của nhân vật: hai người cùng
 * trường nhìn giống nhau, và màu không đổi giữa các lần vào game. Khi có tài nguyên hình thật
 * (các mốc sau) client có thể bỏ qua trường này.
 */
const COLOR_BY_SCHOOL: Record<Character['school'], string> = {
  haruna: '#4f8ef7',
  hirosaki: '#e0693f',
  ookaza: '#4bbf6b',
};

/** Màu của một người chơi theo trường. */
export function playerColor(school: Character['school']): string {
  return COLOR_BY_SCHOOL[school];
}

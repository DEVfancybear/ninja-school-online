import { type CharacterClass, type School, type StatBlock } from '@ninja/shared';

/**
 * Nhãn tiếng Việt để hiển thị. Định danh trong hợp đồng (`haruna`, `dao`, ...) vẫn là
 * chữ thường không dấu — bảng này chỉ dùng cho giao diện.
 */
export const SCHOOL_LABELS: Record<School, string> = {
  haruna: 'Haruna',
  hirosaki: 'Hirosaki',
  ookaza: 'Ookaza',
};

export const CLASS_LABELS: Record<CharacterClass, string> = {
  dao: 'Đao',
  quat: 'Quạt',
  kiem: 'Kiếm',
  phieu_tieu: 'Phiêu Tiêu',
  kunai: 'Kunai',
  cung: 'Cung',
};

/**
 * Nhãn chỉ số cộng thêm của một món đồ. Hợp đồng đặt tên chỉ số bằng tiếng Anh (`strength`,
 * `agility`, `spirit`, `hp`, `mp`), nên phần chữ hiển thị nằm ở đây; `hp`/`mp` dùng đúng chữ mà
 * HUD đang hiện.
 */
export const STAT_LABELS: Record<keyof StatBlock, string> = {
  strength: 'Sức mạnh',
  agility: 'Nhanh nhẹn',
  spirit: 'Tinh thần',
  hp: 'Máu',
  mp: 'Nội lực',
};

/** Phần chỉ số một món đồ cộng thêm, dạng "Sức mạnh +2 · Máu +20"; rỗng khi món không cộng gì. */
export function statsText(stats: StatBlock): string {
  return (Object.keys(STAT_LABELS) as (keyof StatBlock)[])
    .filter((key) => stats[key] > 0)
    .map((key) => `${STAT_LABELS[key]} +${stats[key]}`)
    .join(' · ');
}

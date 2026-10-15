import { type CharacterClass, type School } from '@ninja/shared';

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

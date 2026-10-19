import {
  type CharacterClass,
  type QuestObjectiveView,
  type QuestRewardView,
  type School,
  type StatBlock,
} from '@ninja/shared';

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

/**
 * Một mục tiêu nhiệm vụ kèm tiến độ, dạng "Đánh hạ 2 Bù Nhìn Tập Luyện (1/2)".
 *
 * Chữ mô tả mục tiêu do server soạn sẵn (lấy từ `game-data/quests/*.json`) vì chỉ nó biết tên quái
 * hay NPC; client chỉ nối thêm phần tiến độ đã tính, không tự đếm lại.
 */
export function questObjectiveText(objective: QuestObjectiveView): string {
  return `${objective.description} (${objective.progress}/${objective.count})`;
}

/**
 * Phần thưởng của một nhiệm vụ, dạng "150 kinh nghiệm · 180 yên · 2 Bánh Bao Hấp".
 * Phần bằng 0 hoặc danh sách rỗng thì bỏ đi; không có gì để nhận thì trả về chuỗi rỗng.
 */
export function questRewardText(rewards: QuestRewardView): string {
  const parts: string[] = [];
  if (rewards.exp > 0) {
    parts.push(`${rewards.exp} kinh nghiệm`);
  }
  if (rewards.yen > 0) {
    parts.push(`${rewards.yen} yên`);
  }
  for (const item of rewards.items) {
    parts.push(`${item.quantity} ${item.name}`);
  }
  return parts.join(' · ');
}

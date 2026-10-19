/**
 * Nhiệm vụ chính tuyến (M5). Hằng số ở đây để client và server dùng chung: server quyết định
 * luật, client hiện trạng thái, trần và nhãn mà không tự đặt lại.
 */

/** Loại mục tiêu của một nhiệm vụ; mỗi loại gắn với một sự kiện cụ thể trong thế giới. */
export const QUEST_OBJECTIVE_KINDS = ['talk', 'kill', 'reach', 'collect'] as const;
export type QuestObjectiveKind = (typeof QUEST_OBJECTIVE_KINDS)[number];

/** Trạng thái lưu trong database: chỉ có đang làm hoặc đã trả. */
export const QUEST_STATUSES = ['active', 'completed'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

/**
 * Trạng thái client nhìn thấy, suy ra từ dữ liệu đã lưu:
 * `available` = đủ điều kiện nhận, `active` = đang làm, `ready` = xong mục tiêu chờ trả,
 * `completed` = đã trả.
 */
export const QUEST_VIEW_STATES = ['available', 'active', 'ready', 'completed'] as const;
export type QuestViewState = (typeof QUEST_VIEW_STATES)[number];

/** Trần số nhiệm vụ nhận cùng lúc — chặn nhận hết rồi mới làm. */
export const MAX_ACTIVE_QUESTS = 5;

/**
 * Nhãn tiếng Việt của tính năng mở khóa theo mốc nhiệm vụ. Chương 1 mở khóa tính năng của các mốc
 * sau (nhóm ở M6, Lôi Đài ở M6); M5 không chặn tính năng nào đang có nên không ai bị kẹt vì cờ này.
 */
export const QUEST_FEATURE_LABELS: Readonly<Record<string, string>> = {
  party: 'Lập nhóm',
  arena: 'Lôi Đài',
};

/** Nhãn của một cờ tính năng; cờ lạ thì hiện nguyên id để còn lần ra dữ liệu. */
export function questFeatureLabel(feature: string): string {
  return QUEST_FEATURE_LABELS[feature] ?? feature;
}

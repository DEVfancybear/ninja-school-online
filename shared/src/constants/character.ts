/** Quy tắc tên nhân vật. */
export const CHARACTER_NAME_MIN_LENGTH = 3;
export const CHARACTER_NAME_MAX_LENGTH = 12;

/**
 * Tên nhân vật: chữ cái (kể cả tiếng Việt có dấu) và chữ số, không dấu cách, không ký tự đặc biệt.
 * Dùng chung cho client và server nên chỉ định nghĩa ở đây một lần.
 */
export const CHARACTER_NAME_PATTERN = /^[\p{L}\p{N}]+$/u;

/** Số ô tối đa trong túi đồ (M3 chưa có ngân hàng nên túi là chỗ chứa duy nhất). */
export const INVENTORY_CAPACITY = 40;

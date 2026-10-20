/**
 * Xã hội (M6): bạn bè, tổ đội và kênh chat. Mọi giới hạn nằm ở đây để server kiểm và client hiện
 * đúng cùng một con số.
 */

/** Số bạn tối đa của một nhân vật. Lời mời đang chờ **không** tính vào trần này. */
export const MAX_FRIENDS = 50;

/** Số người tối đa trong một tổ đội, kể cả đội trưởng. */
export const PARTY_MAX_MEMBERS = 4;

/**
 * Giãn cách tối thiểu giữa hai tin **thế giới** của cùng một người (ms). Kênh thế giới phát cho mọi
 * người đang online nên phải chậm hơn kênh bản đồ (`CHAT_MIN_INTERVAL_MS` = 1 giây).
 */
export const WORLD_CHAT_MIN_INTERVAL_MS = 5_000;

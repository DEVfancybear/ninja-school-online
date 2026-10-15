/** Nhịp cập nhật của server (mili giây). 10 Hz theo thiết kế trong docs/02-architecture/network-and-data.md. */
export const TICK_RATE_MS = 100;

/** Tốc độ di chuyển của nhân vật, tính bằng pixel mỗi giây. */
export const PLAYER_SPEED_PX_PER_SEC = 160;

/** Kích thước một ô gạch (pixel). Map có thể ghi đè, nhưng mặc định dùng giá trị này. */
export const DEFAULT_TILE_SIZE = 32;

/** Giới hạn kích thước bản đồ (số ô) để chặn dữ liệu map sai. */
export const MAP_MIN_TILES = 8;
export const MAP_MAX_TILES = 200;

/** Khoảng cách tối đa (pixel) client được phép yêu cầu di chuyển trong một lệnh. */
export const MAX_MOVE_DISTANCE_PX = 600;

/** Độ dài tối đa của một tin nhắn chat. */
export const CHAT_MAX_LENGTH = 200;

/** Thời gian tối thiểu giữa hai tin nhắn chat của cùng một người chơi (chống spam). */
export const CHAT_MIN_INTERVAL_MS = 1000;

/** Client gửi ping cách nhau bao lâu, và server cắt kết nối sau bao lâu không thấy gói tin. */
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 30000;

/** Số tin nhắn chat gần nhất giữ lại để gửi cho người vừa vào map. */
export const CHAT_BACKLOG_SIZE = 20;

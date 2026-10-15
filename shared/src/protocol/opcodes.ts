/**
 * Mã gói tin. Dải mã theo docs/02-architecture/network-and-data.md:
 * 0x01xx hệ thống, 0x02xx nhân vật, 0x03xx thế giới, 0x04xx túi đồ, 0x05xx chiến đấu,
 * 0x06xx nhiệm vụ, 0x07xx xã hội, 0x08xx lôi đài, 0x09xx quản trị.
 *
 * Quy ước tên: `C2S_*` = client gửi lên, `S2C_*` = server gửi xuống.
 */
export const Opcode = {
  /** Bắt tay: client gửi token + phiên bản giao thức. */
  C2S_HELLO: 0x0101,
  /** Server chấp nhận (kèm nhịp tick) hoặc từ chối rồi đóng kết nối. */
  S2C_HELLO: 0x0102,
  C2S_PING: 0x0103,
  S2C_PONG: 0x0104,
  /** Lỗi ở mức kết nối (khác lỗi HTTP 4xx của REST API). */
  S2C_ERROR: 0x0105,
  /** Thông báo hệ thống chung (vào/ra map, ai đó vào map...). */
  S2C_NOTIFY: 0x0106,

  /** Client xin vào một map (hoặc chuyển map qua cổng). */
  C2S_ENTER_MAP: 0x0301,
  /** Server gửi dữ liệu map + toàn bộ thực thể đang có. */
  S2C_ENTER_MAP: 0x0302,
  /** Client báo ý định di chuyển tới một điểm. */
  C2S_MOVE: 0x0303,
  /** Server phát vị trí mới của (nhiều) thực thể. */
  S2C_ENTITY_MOVE: 0x0304,
  /** Một thực thể vào tầm nhìn của client. */
  S2C_ENTITY_ADD: 0x0305,
  /** Một thực thể rời khỏi map (thoát game hoặc chuyển map). */
  S2C_ENTITY_REMOVE: 0x0306,
  /** Client gửi tin nhắn chat. */
  C2S_CHAT: 0x0307,
  /** Server phát tin nhắn chat cho cả map. */
  S2C_CHAT: 0x0308,
  /** Client bấm vào NPC để nói chuyện. */
  C2S_NPC_TALK: 0x0309,
  /** Server trả lời hội thoại của NPC. */
  S2C_NPC_DIALOG: 0x030a,
} as const;

export type Opcode = (typeof Opcode)[keyof typeof Opcode];

/** Tên dễ đọc của từng mã, dùng cho log và thông báo lỗi. */
export const OPCODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Opcode).map(([name, value]) => [value, name]),
);

/** Kênh chat ở M2. Các kênh khác (thế giới, nhóm, bang) để các cột mốc sau. */
export const CHAT_CHANNELS = ['map', 'system'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

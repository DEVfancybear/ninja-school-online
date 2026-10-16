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

  /** Chỉ số nhân vật (cấp, kinh nghiệm, máu, nội lực, chiêu đã học) — gửi sau bắt tay và mỗi lần đổi. */
  S2C_CHARACTER: 0x0201,
  /** Nhân vật vừa lên cấp (kèm chiêu mới học được). */
  S2C_LEVEL_UP: 0x0202,

  /** Client dùng một vật phẩm trong túi. */
  C2S_USE_ITEM: 0x0401,
  /** Toàn bộ túi đồ sau khi có thay đổi. */
  S2C_INVENTORY_UPDATE: 0x0402,
  /** Mặc một món trang bị đang có trong túi vào ô của nó. */
  C2S_EQUIP: 0x0403,
  /** Tháo món đang mặc ở một ô ra túi. */
  C2S_UNEQUIP: 0x0404,
  /** Toàn bộ trang bị đang mặc, gửi lại mỗi khi trang bị đổi. */
  S2C_EQUIPMENT: 0x0405,
  /** Mua một món ở shop của NPC đang nói chuyện. */
  C2S_SHOP_BUY: 0x0406,
  /** Bán một món trong túi cho shop. */
  C2S_SHOP_SELL: 0x0407,
  /** Thử cường hóa một món trang bị (tốn yên và đá). */
  C2S_UPGRADE: 0x0408,
  /** Kết quả một lần cường hóa: thành công hay thất bại, cấp mới, chi phí đã mất. */
  S2C_UPGRADE_RESULT: 0x0409,

  /** Client "chạm" vào một con quái để vào trận. */
  C2S_ATTACK_MOB: 0x0501,
  /** Trận bắt đầu (hoặc có người vào giữa trận): ai đang tham gia, tới lượt ai. */
  S2C_BATTLE_START: 0x0502,
  /** Đổi lượt: ai hành động tiếp theo và còn bao lâu. */
  S2C_BATTLE_TURN: 0x0503,
  /** Client chọn hành động trong lượt của mình. */
  C2S_BATTLE_ACTION: 0x0504,
  /** Kết quả một hành động: sát thương, hồi máu, nhật ký và trạng thái mới của mọi người. */
  S2C_BATTLE_RESULT: 0x0505,
  /** Trận kết thúc: thắng, thua hay chạy thoát, kèm phần thưởng của người nhận. */
  S2C_BATTLE_END: 0x0506,
} as const;

export type Opcode = (typeof Opcode)[keyof typeof Opcode];

/** Tên dễ đọc của từng mã, dùng cho log và thông báo lỗi. */
export const OPCODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Opcode).map(([name, value]) => [value, name]),
);

/** Kênh chat ở M2. Các kênh khác (thế giới, nhóm, bang) để các cột mốc sau. */
export const CHAT_CHANNELS = ['map', 'system'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

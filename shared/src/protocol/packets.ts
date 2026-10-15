import { z } from 'zod';
import { CLASSES, SCHOOLS } from '../constants/game.js';
import { CHAT_MAX_LENGTH, MAX_MOVE_DISTANCE_PX } from '../constants/world.js';
import { CHAT_CHANNELS, Opcode } from './opcodes.js';

/** Toạ độ trong thế giới, tính bằng pixel. */
export const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** Loại thực thể được vẽ trên map. */
export const ENTITY_KINDS = ['player', 'npc'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const EntitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ENTITY_KINDS),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  x: z.number().finite(),
  y: z.number().finite(),
  /** Chỉ có ở người chơi. */
  level: z.number().int().min(1).optional(),
  school: z.enum(SCHOOLS).optional(),
  class: z.enum(CLASSES).optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

// ---------------------------------------------------------------- hệ thống

export const ClientHelloSchema = z.object({
  token: z.string().min(1),
  protocolVersion: z.number().int().min(1),
  clientVersion: z.string().min(1).max(32).default('dev'),
  /**
   * Nhân vật muốn vào thế giới. Bỏ trống thì server chọn nhân vật tạo gần nhất của tài khoản.
   * Tài khoản chưa có nhân vật nào thì server trả lỗi `no_character`.
   */
  characterId: z.uuid().optional(),
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

export const ServerHelloSchema = z.object({
  protocolVersion: z.number().int().min(1),
  tickRateMs: z.number().int().min(1),
  characterId: z.string().min(1),
  characterName: z.string().min(1),
  mapId: z.string().min(1),
  /** Thời điểm server trả lời (ms kể từ epoch), client dùng để ước lượng độ trễ. */
  serverTime: z.number().int().min(0),
});
export type ServerHello = z.infer<typeof ServerHelloSchema>;

export const PingSchema = z.object({
  /** Thời điểm client gửi (ms kể từ epoch) — server trả lại nguyên vẹn. */
  clientTime: z.number().int().min(0),
});
export type Ping = z.infer<typeof PingSchema>;

export const PongSchema = PingSchema.extend({ serverTime: z.number().int().min(0) });
export type Pong = z.infer<typeof PongSchema>;

export const ErrorCode = {
  PROTOCOL_MISMATCH: 'protocol_mismatch',
  UNAUTHORIZED: 'unauthorized',
  BAD_PACKET: 'bad_packet',
  RATE_LIMITED: 'rate_limited',
  NO_CHARACTER: 'no_character',
  UNKNOWN_MAP: 'unknown_map',
  UNKNOWN_ENTITY: 'unknown_entity',
  INTERNAL: 'internal_error',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ServerErrorSchema = z.object({
  code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
  message: z.string().min(1),
  /** Lỗi nghiêm trọng: server đóng kết nối sau khi gửi. */
  fatal: z.boolean().default(false),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;

export const NotifySchema = z.object({
  message: z.string().min(1),
});
export type Notify = z.infer<typeof NotifySchema>;

// ----------------------------------------------------------------- thế giới

export const EnterMapSchema = z.object({
  mapId: z.string().min(1),
  /** Điểm spawn muốn vào; bỏ trống thì server chọn điểm mặc định. */
  spawnId: z.string().min(1).optional(),
});
export type EnterMap = z.infer<typeof EnterMapSchema>;

export const MapSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  tileSize: z.number().int().min(1),
  tiles: z.array(
    z.object({
      id: z.number().int().min(0),
      color: z.string(),
      blocked: z.boolean(),
    }),
  ),
  ground: z.array(z.array(z.number().int().min(-1))),
  decor: z.array(z.array(z.number().int().min(-1))),
});
export type MapSnapshot = z.infer<typeof MapSnapshotSchema>;

export const ServerEnterMapSchema = z.object({
  map: MapSnapshotSchema,
  entity: EntitySchema,
  entities: z.array(EntitySchema),
  chatBacklog: z.array(
    z.object({
      channel: z.enum(CHAT_CHANNELS),
      fromName: z.string().min(1),
      text: z.string().min(1),
      at: z.number().int().min(0),
    }),
  ),
});
export type ServerEnterMap = z.infer<typeof ServerEnterMapSchema>;

export const MoveSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Move = z.infer<typeof MoveSchema>;

export const EntityMoveSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
        /** Hướng đi để client vẽ hoạt ảnh; 8 hướng, 'none' khi đứng yên. */
        facing: z.enum(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'none']),
      }),
    )
    .min(1),
});
export type EntityMove = z.infer<typeof EntityMoveSchema>;

export const EntityAddSchema = z.object({ entity: EntitySchema });
export type EntityAdd = z.infer<typeof EntityAddSchema>;

export const EntityRemoveSchema = z.object({ id: z.string().min(1) });
export type EntityRemove = z.infer<typeof EntityRemoveSchema>;

export const ChatSendSchema = z.object({
  channel: z.literal('map'),
  text: z.string().min(1).max(CHAT_MAX_LENGTH),
});
export type ChatSend = z.infer<typeof ChatSendSchema>;

export const ChatMessageSchema = z.object({
  channel: z.enum(CHAT_CHANNELS),
  fromId: z.string().min(1),
  fromName: z.string().min(1),
  text: z.string().min(1),
  at: z.number().int().min(0),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const NpcTalkSchema = z.object({ npcId: z.string().min(1) });
export type NpcTalk = z.infer<typeof NpcTalkSchema>;

export const NpcDialogSchema = z.object({
  npcId: z.string().min(1),
  npcName: z.string().min(1),
  lines: z.array(z.object({ speaker: z.string().min(1), text: z.string().min(1) })),
});
export type NpcDialog = z.infer<typeof NpcDialogSchema>;

// --------------------------------------------------- bảng schema theo mã gói

/**
 * Bảng schema theo mã gói. Kiểu ghi tường minh là `z.ZodType` để TypeScript không suy ra
 * một union khổng lồ từ các schema khác nhau (union đó không dùng được khi tra theo `op`).
 */
export type PacketSchemaTable = Readonly<Record<number, z.ZodType>>;

/** Gói tin client được phép gửi lên, kèm schema kiểm tra phần thân. */
export const CLIENT_PACKETS: PacketSchemaTable = {
  [Opcode.C2S_HELLO]: ClientHelloSchema,
  [Opcode.C2S_PING]: PingSchema,
  [Opcode.C2S_ENTER_MAP]: EnterMapSchema,
  [Opcode.C2S_MOVE]: MoveSchema,
  [Opcode.C2S_CHAT]: ChatSendSchema,
  [Opcode.C2S_NPC_TALK]: NpcTalkSchema,
} as const;

/** Gói tin server gửi xuống, dùng cho client kiểm tra và cho kiểm thử. */
export const SERVER_PACKETS: PacketSchemaTable = {
  [Opcode.S2C_HELLO]: ServerHelloSchema,
  [Opcode.S2C_PONG]: PongSchema,
  [Opcode.S2C_ERROR]: ServerErrorSchema,
  [Opcode.S2C_NOTIFY]: NotifySchema,
  [Opcode.S2C_ENTER_MAP]: ServerEnterMapSchema,
  [Opcode.S2C_ENTITY_MOVE]: EntityMoveSchema,
  [Opcode.S2C_ENTITY_ADD]: EntityAddSchema,
  [Opcode.S2C_ENTITY_REMOVE]: EntityRemoveSchema,
  [Opcode.S2C_CHAT]: ChatMessageSchema,
  [Opcode.S2C_NPC_DIALOG]: NpcDialogSchema,
} as const;

/** Mã gói tin mà client được phép gửi (theo đúng bảng ở trên). */
export const CLIENT_OPCODES: readonly number[] = Object.keys(CLIENT_PACKETS).map(Number);
export const SERVER_OPCODES: readonly number[] = Object.keys(SERVER_PACKETS).map(Number);

/** Khoảng cách tối đa cho một lệnh di chuyển, dùng chung cho kiểm tra phía client và server. */
export const MAX_MOVE_DISTANCE = MAX_MOVE_DISTANCE_PX;

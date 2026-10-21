import { z } from 'zod';
import { CLASSES, SCHOOLS } from '../constants/game.js';
import { INVENTORY_CAPACITY } from '../constants/character.js';
import { EQUIP_SLOTS, SELL_PRICE_RATIO } from '../constants/equipment.js';
import { CHAT_MAX_LENGTH, MAX_MOVE_DISTANCE_PX } from '../constants/world.js';
import { MAX_ACTIVE_QUESTS, QUEST_OBJECTIVE_KINDS, QUEST_VIEW_STATES } from '../constants/quest.js';
import { MAX_FRIENDS, PARTY_MAX_MEMBERS } from '../constants/social.js';
import { LEADERBOARD_MAX_ENTRIES, LEADERBOARDS, MAIL_MAX_ENTRIES } from '../constants/arena.js';
import { ITEM_KINDS } from '../schemas/item.js';
import { MONSTER_SHAPES } from '../schemas/monster.js';
import { StatBlockSchema } from '../schemas/school.js';
import { CHAT_CHANNELS, CHAT_SEND_CHANNELS, Opcode } from './opcodes.js';

/** Toạ độ trong thế giới, tính bằng pixel. */
export const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** Loại thực thể được vẽ trên map. */
export const ENTITY_KINDS = ['player', 'npc', 'monster'] as const;
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
  /** Chỉ có ở quái: máu hiện tại để client vẽ thanh máu ngay trên bản đồ. */
  hp: z.number().int().min(0).optional(),
  maxHp: z.number().int().min(1).optional(),
  /** Chỉ có ở quái: chọn hình dáng vẽ (xem `MONSTER_SHAPES`). */
  shape: z.enum(MONSTER_SHAPES).optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

// ----------------------------------------------------------- shop (M4)

/** Một món shop đang bán: đủ để client hiện bảng hàng mà không cần đọc `game-data`. */
export const ShopEntrySchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(ITEM_KINDS),
  price: z.number().int().min(0),
  /** Giá shop mua lại món này (`sellPrice()` trong `shared/src/constants/equipment.ts`). */
  sellPrice: z.number().int().min(0),
  levelRequired: z.number().int().min(1),
  description: z.string().default(''),
  slot: z.enum(EQUIP_SLOTS).nullable().default(null),
  stats: StatBlockSchema.default({ strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 }),
  upgradeMaxLevel: z.number().int().min(0).default(0),
  healHp: z.number().int().min(0).optional(),
  healMp: z.number().int().min(0).optional(),
});
export type ShopEntry = z.infer<typeof ShopEntrySchema>;

/** Quầy hàng của một NPC, gửi kèm hội thoại khi bấm vào NPC bán hàng. */
export const ShopSchema = z.object({
  /** Tỉ lệ shop mua lại, để client hiện giá bán mà không phải biết luật ở phía server. */
  sellRatio: z.number().min(0).max(1).default(SELL_PRICE_RATIO),
  entries: z.array(ShopEntrySchema),
});
export type Shop = z.infer<typeof ShopSchema>;

// ----------------------------------------------------------- nhiệm vụ (M5)

/** Một mục tiêu nhiệm vụ kèm tiến độ hiện tại; client hiện thẳng, không tự tính lại. */
export const QuestObjectiveViewSchema = z.object({
  kind: z.enum(QUEST_OBJECTIVE_KINDS),
  targetId: z.string().min(1),
  description: z.string().min(1),
  count: z.number().int().min(1),
  /** Đã làm được bao nhiêu, luôn kẹp trong `[0, count]`. */
  progress: z.number().int().min(0),
  done: z.boolean(),
});
export type QuestObjectiveView = z.infer<typeof QuestObjectiveViewSchema>;

/** Phần thưởng đã tra tên sẵn để client hiện được mà không cần đọc game-data. */
export const QuestRewardViewSchema = z.object({
  exp: z.number().int().min(0),
  yen: z.number().int().min(0),
  items: z.array(
    z.object({
      itemId: z.string().min(1),
      name: z.string().min(1),
      quantity: z.number().int().min(1),
    }),
  ),
});
export type QuestRewardView = z.infer<typeof QuestRewardViewSchema>;

/** Một nhiệm vụ theo góc nhìn của người chơi, dùng cho nhật ký nhiệm vụ và hội thoại NPC. */
export const QuestViewSchema = z.object({
  questId: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().default(''),
  chapter: z.number().int().min(1),
  state: z.enum(QUEST_VIEW_STATES),
  giverNpcId: z.string().min(1),
  giverName: z.string().min(1),
  turnInNpcId: z.string().min(1),
  turnInName: z.string().min(1),
  levelRequired: z.number().int().min(1),
  objectives: z.array(QuestObjectiveViewSchema).min(1),
  rewards: QuestRewardViewSchema,
  unlocks: z.array(z.string()).default([]),
});
export type QuestView = z.infer<typeof QuestViewSchema>;

/** Nhiệm vụ chưa nhận mà người chơi đã đủ điều kiện nhận — dùng để chỉ đường cho người chơi mới. */
export const QuestAvailableSchema = z.object({
  questId: z.string().min(1),
  name: z.string().min(1),
  giverNpcId: z.string().min(1),
  giverName: z.string().min(1),
  turnInNpcId: z.string().min(1),
  turnInName: z.string().min(1),
  levelRequired: z.number().int().min(1),
});
export type QuestAvailable = z.infer<typeof QuestAvailableSchema>;

/** Toàn bộ trạng thái nhiệm vụ của nhân vật — gửi sau bắt hay và mỗi lần có gì đổi. */
export const QuestUpdateSchema = z.object({
  /** Nhiệm vụ đang làm (kể cả đã xong mục tiêu, chờ trả), theo thứ tự nhận. */
  active: z.array(QuestViewSchema),
  /** Nhiệm vụ đủ điều kiện nhận, chưa nhận. */
  available: z.array(QuestAvailableSchema),
  /** Id các nhiệm vụ đã trả xong. */
  completed: z.array(z.string()),
  /** Cờ tính năng đã mở khóa bằng nhiệm vụ (`questFeatureLabel()` để hiện tên tiếng Việt). */
  unlockedFeatures: z.array(z.string()),
  /** Trần số nhiệm vụ nhận cùng lúc, client hiện trong nhật ký. */
  maxActive: z.number().int().min(1).default(MAX_ACTIVE_QUESTS),
});
export type QuestUpdate = z.infer<typeof QuestUpdateSchema>;

export const QuestAcceptSchema = z.object({ questId: z.string().min(1) });
export type QuestAccept = z.infer<typeof QuestAcceptSchema>;

export const QuestCompleteSchema = z.object({ questId: z.string().min(1) });
export type QuestComplete = z.infer<typeof QuestCompleteSchema>;

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

  // Chiến đấu (M3): mỗi nguyên nhân từ chối có mã riêng để client nói đúng lý do cho người chơi.
  IN_BATTLE: 'in_battle',
  BATTLE_NOT_FOUND: 'battle_not_found',
  NOT_YOUR_TURN: 'not_your_turn',
  OUT_OF_RANGE: 'out_of_range',
  MONSTER_GONE: 'monster_gone',
  SKILL_NOT_KNOWN: 'skill_not_known',
  SKILL_COOLDOWN: 'skill_cooldown',
  NOT_ENOUGH_MP: 'not_enough_mp',
  ITEM_NOT_OWNED: 'item_not_owned',
  ITEM_NOT_USABLE: 'item_not_usable',
  ITEM_NO_EFFECT: 'item_no_effect',
  INVALID_TARGET: 'invalid_target',

  // Trang bị, shop và cường hóa (M4): mỗi lý do từ chối một mã riêng để client nói đúng lý do.
  NOT_EQUIPPABLE: 'not_equippable',
  LEVEL_TOO_LOW: 'level_too_low',
  ALREADY_OWNED: 'already_owned',
  NOT_ENOUGH_YEN: 'not_enough_yen',
  NOT_FOR_SALE: 'not_for_sale',
  ITEM_EQUIPPED: 'item_equipped',
  NOT_UPGRADABLE: 'not_upgradable',
  UPGRADE_MAXED: 'upgrade_maxed',
  NOT_ENOUGH_MATERIAL: 'not_enough_material',
  INVENTORY_FULL: 'inventory_full',

  // Nhiệm vụ (M5): mỗi lý do từ chối một mã riêng để người chơi biết vì sao không nhận/trả được.
  QUEST_NOT_FOUND: 'quest_not_found',
  QUEST_LOCKED: 'quest_locked',
  QUEST_ALREADY_ACTIVE: 'quest_already_active',
  QUEST_ALREADY_DONE: 'quest_already_done',
  QUEST_TOO_MANY: 'quest_too_many',
  QUEST_NOT_READY: 'quest_not_ready',
  QUEST_WRONG_NPC: 'quest_wrong_npc',
  DIALOG_NOT_OPEN: 'dialog_not_open',

  // Xã hội (M6): bạn bè và tổ đội. Mỗi lý do từ chối một mã riêng để client nói đúng nguyên nhân.
  CHARACTER_NOT_FOUND: 'character_not_found',
  FRIEND_SELF: 'friend_self',
  FRIEND_ALREADY: 'friend_already',
  FRIEND_NOT_FOUND: 'friend_not_found',
  FRIENDS_FULL: 'friends_full',
  PARTY_SELF: 'party_self',
  PARTY_FULL: 'party_full',
  PARTY_ALREADY_MEMBER: 'party_already_member',
  PARTY_NOT_LEADER: 'party_not_leader',
  PARTY_NOT_INVITED: 'party_not_invited',
  NOT_IN_PARTY: 'not_in_party',

  // Lôi Đài và hộp thư (M6).
  ARENA_LEVEL_LOW: 'arena_level_low',
  ARENA_QUEUED: 'arena_queued',
  ARENA_NOT_QUEUED: 'arena_not_queued',
  ARENA_NO_FLEE: 'arena_no_flee',
  MAIL_NOT_FOUND: 'mail_not_found',
  MAIL_CLAIMED: 'mail_claimed',
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

/**
 * Một tin nhắn client gửi lên. `channel` bỏ trống là kênh bản đồ (hợp đồng M2 vẫn còn nguyên).
 *
 * Tin `private` phải kèm `to` (tên nhân vật nhận); các kênh khác **không** được kèm `to` — thừa
 * trường đó là client hiểu sai hợp đồng, nên bị từ chối thay vì lặng lẽ bỏ qua.
 */
export const ChatSendSchema = z
  .object({
    channel: z.enum(CHAT_SEND_CHANNELS).default('map'),
    text: z.string().min(1).max(CHAT_MAX_LENGTH),
    to: z.string().min(1).max(24).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.channel === 'private' && value.to === undefined) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'tin riêng phải kèm người nhận' });
    }
    if (value.channel !== 'private' && value.to !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'chỉ tin riêng mới có người nhận' });
    }
  });
export type ChatSend = z.infer<typeof ChatSendSchema>;

export const ChatMessageSchema = z.object({
  channel: z.enum(CHAT_CHANNELS),
  fromId: z.string().min(1),
  fromName: z.string().min(1),
  text: z.string().min(1),
  at: z.number().int().min(0),
  /** Người nhận của tin `private`; không có ở kênh khác. */
  toName: z.string().min(1).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const NpcTalkSchema = z.object({
  npcId: z.string().min(1),
  /**
   * Lựa chọn trong cây hội thoại đang mở. Bỏ trống là **bắt đầu** nói chuyện (server tự chọn nhánh
   * theo trạng thái nhiệm vụ); có `optionId` là đi tiếp trong cây.
   */
  optionId: z.string().min(1).optional(),
});
export type NpcTalk = z.infer<typeof NpcTalkSchema>;

export const NpcDialogSchema = z.object({
  npcId: z.string().min(1),
  npcName: z.string().min(1),
  lines: z.array(z.object({ speaker: z.string().min(1), text: z.string().min(1) })),
  /** Nhánh hội thoại đang mở trong cây; `null` là hội thoại mặc định (không có nhánh nào khớp). */
  nodeId: z.string().min(1).nullable().default(null),
  /**
   * Lựa chọn người chơi bấm được ở nhánh này; rỗng là hội thoại một chiều. `next` là nhánh sẽ mở
   * khi bấm, `null` nghĩa là **kết thúc hội thoại** (client đóng hộp thoại).
   */
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        next: z.string().min(1).nullable(),
      }),
    )
    .default([]),
  /** Quầy hàng của NPC này; `null` là NPC thường, chỉ nói chuyện. */
  shop: ShopSchema.nullable().default(null),
  /**
   * Nhiệm vụ làm được **ngay tại NPC này**: nhận ở người giao, trả ở người nhận trả. Rỗng là NPC
   * không liên quan tới nhiệm vụ nào của người chơi.
   */
  quests: z.array(QuestViewSchema).default([]),
});
export type NpcDialog = z.infer<typeof NpcDialogSchema>;

// ------------------------------------------------------ nhân vật, túi đồ

/** Một chiêu đã học ở góc nhìn client. */
export const BattleSkillSchema = z.object({
  skillId: z.string().min(1),
  name: z.string().min(1),
  costMp: z.number().int().min(0),
  /** Hồi chiêu tính theo **vòng** (mọi người hành động một lần là hết một vòng). */
  cooldownTurns: z.number().int().min(0),
  levelRequired: z.number().int().min(1),
});
export type BattleSkill = z.infer<typeof BattleSkillSchema>;

/**
 * Chỉ số nhân vật: HUD dùng để vẽ thanh máu/nội lực/kinh nghiệm, trận đấu dùng để biết chiêu nào
 * đang có. Server gửi sau khi bắt tay và mỗi lần chỉ số đổi.
 */
export const CharacterStatsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  school: z.enum(SCHOOLS),
  class: z.enum(CLASSES),
  level: z.number().int().min(1),
  exp: z.number().int().min(0),
  /** Kinh nghiệm cần để lên cấp kế tiếp; `0` nghĩa là đã đạt cấp tối đa. */
  expToNext: z.number().int().min(0),
  yen: z.number().int().min(0),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  strength: z.number().int().min(0),
  agility: z.number().int().min(0),
  spirit: z.number().int().min(0),
  attack: z.number().int().min(0),
  defense: z.number().int().min(0),
  speed: z.number().int().min(0),
  skills: z.array(BattleSkillSchema),
});
export type CharacterStats = z.infer<typeof CharacterStatsSchema>;

export const LevelUpSchema = z.object({
  character: CharacterStatsSchema,
  levelsGained: z.number().int().min(1),
  /** Chiêu vừa học được ở cấp mới; rỗng nếu cấp mới không mở chiêu nào. */
  learnedSkills: z.array(z.object({ skillId: z.string().min(1), name: z.string().min(1) })),
});
export type LevelUp = z.infer<typeof LevelUpSchema>;

/** Một ô trong túi đồ. */
export const InventoryItemSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(ITEM_KINDS),
  quantity: z.number().int().min(1),
  /** Dùng được ngay trong túi (vật phẩm hồi phục) hay không. */
  usable: z.boolean(),
  description: z.string().default(''),
  healHp: z.number().int().min(0).optional(),
  healMp: z.number().int().min(0).optional(),
  /** Ô mặc của món; `null` với vật phẩm không mặc được. */
  slot: z.enum(EQUIP_SLOTS).nullable().default(null),
  /** Cấp cường hóa hiện tại; `0` là món chưa cường hóa. */
  upgradeLevel: z.number().int().min(0).default(0),
  /** Chỉ số món này cộng thêm **ở cấp hiện tại** (đã tính cường hóa). */
  stats: StatBlockSchema.default({ strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 }),
  levelRequired: z.number().int().min(1).default(1),
  price: z.number().int().min(0).default(0),
  /** Giá shop mua lại món này. */
  sellPrice: z.number().int().min(0).default(0),
  /** Cấp cường hóa tối đa của món; `0` là không cường hóa được. */
  upgradeMaxLevel: z.number().int().min(0).default(0),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/** Toàn bộ túi đồ — gửi lại mỗi khi túi đổi thay vì gửi từng ô. */
export const InventoryUpdateSchema = z.object({
  items: z.array(InventoryItemSchema),
  /** Sức chứa túi, để client hiện "12/40" mà không phải biết luật ở phía server. */
  capacity: z.number().int().min(1).default(INVENTORY_CAPACITY),
});
export type InventoryUpdate = z.infer<typeof InventoryUpdateSchema>;

export const UseItemSchema = z.object({ itemId: z.string().min(1) });
export type UseItem = z.infer<typeof UseItemSchema>;

// ------------------------------------------- trang bị, shop, cường hóa (M4)

export const EquipSchema = z.object({ itemId: z.string().min(1) });
export type Equip = z.infer<typeof EquipSchema>;

export const UnequipSchema = z.object({ slot: z.enum(EQUIP_SLOTS) });
export type Unequip = z.infer<typeof UnequipSchema>;

/** Một ô trang bị: món đang mặc, hoặc `null` khi ô trống. */
export const EquipmentSlotSchema = z.object({
  slot: z.enum(EQUIP_SLOTS),
  item: InventoryItemSchema.nullable(),
});
export type EquipmentSlot = z.infer<typeof EquipmentSlotSchema>;

/** Toàn bộ trang bị đang mặc — gửi lại mỗi khi trang bị đổi, cùng cách với túi đồ. */
export const EquipmentUpdateSchema = z.object({
  slots: z.array(EquipmentSlotSchema),
});
export type EquipmentUpdate = z.infer<typeof EquipmentUpdateSchema>;

export const ShopBuySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});
export type ShopBuy = z.infer<typeof ShopBuySchema>;

export const ShopSellSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});
export type ShopSell = z.infer<typeof ShopSellSchema>;

export const UpgradeSchema = z.object({ itemId: z.string().min(1) });
export type Upgrade = z.infer<typeof UpgradeSchema>;

/** Kết quả một lần cường hóa — gửi về cả khi thành công lẫn khi thất bại. */
export const UpgradeResultSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  success: z.boolean(),
  /** Cấp sau lần thử: tăng 1 nếu thành công, giữ nguyên nếu thất bại. */
  upgradeLevel: z.number().int().min(0),
  /** Cấp trước lần thử. */
  previousLevel: z.number().int().min(0),
  /** Tỉ lệ thành công của chính lần thử này, để client nhắc lại cho người chơi. */
  successRate: z.number().min(0).max(1),
  yenCost: z.number().int().min(0),
  materialQty: z.number().int().min(0),
  /** Câu tiếng Việt client hiện thẳng trên thanh thông báo. */
  message: z.string().min(1),
});
export type UpgradeResult = z.infer<typeof UpgradeResultSchema>;

// -------------------------------------------------------------- chiến đấu

/** Người tham gia trận đấu. Id quái có dạng `mob:<mapId>:<số thứ tự>` còn id người chơi là id nhân vật. */
export const COMBATANT_KINDS = ['player', 'monster'] as const;

export const BattleSkillReadySchema = BattleSkillSchema.extend({
  /** Số vòng còn phải chờ mới dùng lại được; `0` là dùng được ngay. */
  readyInTurns: z.number().int().min(0),
});

export const CombatantSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(COMBATANT_KINDS),
  name: z.string().min(1),
  level: z.number().int().min(1),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  attack: z.number().int().min(0),
  defense: z.number().int().min(0),
  speed: z.number().int().min(0),
  alive: z.boolean(),
  /** Chỉ có ở người chơi. */
  skills: z.array(BattleSkillReadySchema).optional(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

/** Trận bắt đầu (với người vừa vào) hoặc có người vào giữa trận. */
export const BATTLE_MODES = ['pve', 'arena'] as const;
export type BattleMode = (typeof BATTLE_MODES)[number];

export const BattleStartSchema = z.object({
  battleId: z.string().min(1),
  roundNo: z.number().int().min(1),
  participants: z.array(CombatantSchema).min(2),
  actorId: z.string().min(1),
  turnMs: z.number().int().min(1),
  turnEndsAt: z.number().int().min(0),
  /**
   * Loại trận: `pve` (đánh quái, M3) hay `arena` (Lôi Đài, M6). Trận Lôi Đài dùng **chung** các gói
   * `S2C_BATTLE_START/TURN/RESULT` và `C2S_BATTLE_ACTION`; chỉ gói kết thúc là riêng
   * (`S2C_ARENA_END`, vì phần thưởng của Lôi Đài là điểm chứ không phải kinh nghiệm/yên).
   */
  mode: z.enum(BATTLE_MODES).default('pve'),
});
export type BattleStart = z.infer<typeof BattleStartSchema>;

/** Đổi lượt. */
export const BattleTurnSchema = z.object({
  battleId: z.string().min(1),
  roundNo: z.number().int().min(1),
  actorId: z.string().min(1),
  turnMs: z.number().int().min(1),
  turnEndsAt: z.number().int().min(0),
});
export type BattleTurn = z.infer<typeof BattleTurnSchema>;

export const AttackMobSchema = z.object({ targetId: z.string().min(1) });
export type AttackMob = z.infer<typeof AttackMobSchema>;

export const BATTLE_ACTIONS = ['attack', 'skill', 'item', 'flee'] as const;
export type BattleActionKind = (typeof BATTLE_ACTIONS)[number];

export const BattleActionSchema = z
  .object({
    battleId: z.string().min(1),
    action: z.enum(BATTLE_ACTIONS),
    skillId: z.string().min(1).optional(),
    itemId: z.string().min(1).optional(),
    /** Bỏ trống thì server tự chọn mục tiêu (con quái đang sống đầu tiên). */
    targetId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'skill' && value.skillId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['skillId'], message: 'dùng chiêu phải kèm skillId' });
    }
    if (value.action === 'item' && value.itemId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['itemId'], message: 'dùng vật phẩm phải kèm itemId' });
    }
  });
export type BattleAction = z.infer<typeof BattleActionSchema>;

export const BATTLE_EVENT_KINDS = [
  'damage',
  'heal',
  'defeat',
  'flee',
  'flee_failed',
  'auto',
] as const;

/** Một dòng trong nhật ký trận đấu. `text` là câu tiếng Việt client hiện thẳng. */
export const BattleEventSchema = z.object({
  kind: z.enum(BATTLE_EVENT_KINDS),
  actorId: z.string().min(1),
  targetId: z.string().min(1).optional(),
  value: z.number().int().optional(),
  critical: z.boolean().optional(),
  /** Tên chiêu hoặc vật phẩm vừa dùng, nếu có. */
  name: z.string().min(1).optional(),
  text: z.string().min(1),
});
export type BattleEvent = z.infer<typeof BattleEventSchema>;

/** Kết quả một hành động, phát cho mọi người trong trận. */
export const BattleResultSchema = z.object({
  battleId: z.string().min(1),
  roundNo: z.number().int().min(1),
  actorId: z.string().min(1),
  action: z.enum(['attack', 'skill', 'item', 'flee', 'timeout']),
  events: z.array(BattleEventSchema),
  participants: z.array(CombatantSchema).min(1),
});
export type BattleResult = z.infer<typeof BattleResultSchema>;

export const BATTLE_OUTCOMES = ['victory', 'defeat', 'fled'] as const;

export const BattleEndSchema = z.object({
  battleId: z.string().min(1),
  outcome: z.enum(BATTLE_OUTCOMES),
  /** Tên quái để client viết câu kết trận. */
  monsterName: z.string().min(1),
  /** Phần thưởng của **chính người nhận** gói tin này; `null` khi thua hoặc chạy thoát. */
  rewards: z
    .object({
      exp: z.number().int().min(0),
      yen: z.number().int().min(0),
      level: z.number().int().min(1),
      levelsGained: z.number().int().min(0),
      drops: z.array(
        z.object({
          itemId: z.string().min(1),
          name: z.string().min(1),
          qty: z.number().int().min(1),
        }),
      ),
    })
    .nullable(),
  participants: z.array(CombatantSchema).min(1),
});
export type BattleEnd = z.infer<typeof BattleEndSchema>;

// ------------------------------------------------------------- xã hội (M6)

/** Một người trong danh sách bạn hoặc tổ đội. Tên là **địa chỉ** dùng chung cho mọi gói xã hội. */
export const SocialPersonSchema = z.object({
  name: z.string().min(1),
  level: z.number().int().min(1),
  school: z.enum(SCHOOLS),
  class: z.enum(CLASSES),
  online: z.boolean(),
});
export type SocialPerson = z.infer<typeof SocialPersonSchema>;

/**
 * Toàn bộ trạng thái xã hội của nhân vật: bạn bè, lời mời nhận được và lời mời đã gửi. Gửi sau bắt
 * tay và mỗi lần danh sách đổi (kể cả khi người khác đổi trạng thái online).
 */
export const SocialUpdateSchema = z.object({
  friends: z.array(SocialPersonSchema),
  incoming: z.array(SocialPersonSchema),
  outgoing: z.array(SocialPersonSchema),
  maxFriends: z.number().int().min(1).default(MAX_FRIENDS),
});
export type SocialUpdate = z.infer<typeof SocialUpdateSchema>;

/** Tên nhân vật trong các gói bạn bè. */
export const PersonNameSchema = z.object({ name: z.string().min(1).max(24) });
export type PersonName = z.infer<typeof PersonNameSchema>;

export const PartyInviteSchema = PersonNameSchema;
export type PartyInvite = z.infer<typeof PersonNameSchema>;
export const PartyKickSchema = PersonNameSchema;
export type PartyKick = z.infer<typeof PersonNameSchema>;
/** Trả lời lời mời vào đội: địa chỉ là **đội trưởng** đã mời mình. */
export const PartyReplySchema = z.object({ leaderName: z.string().min(1).max(24) });
export type PartyReply = z.infer<typeof PartyReplySchema>;

/**
 * Trạng thái tổ đội của chính người nhận. Không có đội thì `partyId`/`leaderName` là `null` và
 * `members` rỗng; `invites` vẫn có thể có lời mời đang chờ.
 */
export const PartyUpdateSchema = z.object({
  partyId: z.string().min(1).nullable(),
  leaderName: z.string().min(1).nullable(),
  members: z.array(SocialPersonSchema),
  invites: z.array(
    z.object({
      fromName: z.string().min(1),
      fromLevel: z.number().int().min(1),
    }),
  ),
  maxMembers: z.number().int().min(1).default(PARTY_MAX_MEMBERS),
});
export type PartyUpdate = z.infer<typeof PartyUpdateSchema>;

/** Một món quà trong thư. */
export const MailItemSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().int().min(1),
});
export type MailItem = z.infer<typeof MailItemSchema>;

export const MailSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().default(''),
  yen: z.number().int().min(0).default(0),
  items: z.array(MailItemSchema).default([]),
  claimed: z.boolean(),
  /** Thời điểm server gửi thư (ms epoch). */
  sentAt: z.number().int().min(0),
});
export type Mail = z.infer<typeof MailSchema>;

export const MailsSchema = z.object({
  mails: z.array(MailSchema),
  maxEntries: z.number().int().min(1).default(MAIL_MAX_ENTRIES),
});
export type Mails = z.infer<typeof MailsSchema>;

export const MailClaimSchema = z.object({ mailId: z.string().min(1) });
export type MailClaim = z.infer<typeof MailClaimSchema>;

// ------------------------------------------------------- Lôi Đài (M6)

/** Trạng thái Lôi Đài của chính người nhận. Điểm chỉ đổi khi trận kết thúc. */
export const ArenaStateSchema = z.object({
  queued: z.boolean(),
  /** Số người đang chờ ghép trận, tính cả mình. */
  queueSize: z.number().int().min(0),
  rating: z.number().int().min(0),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
});
export type ArenaState = z.infer<typeof ArenaStateSchema>;

/**
 * Trận Lôi Đài kết thúc — gói riêng thay cho `S2C_BATTLE_END` (phần thưởng của Lôi Đài là điểm, không
 * phải kinh nghiệm/yên). Mỗi bên nhận **điểm của chính mình**, nên `outcome` là thắng hay thua của
 * người nhận.
 */
export const ArenaEndSchema = z.object({
  battleId: z.string().min(1),
  outcome: z.enum(['win', 'loss']),
  reason: z.enum(['defeat', 'opponent_left']),
  ratingBefore: z.number().int().min(0),
  ratingAfter: z.number().int().min(0),
  ratingDelta: z.number().int(),
  opponentName: z.string().min(1),
  /** Điểm của đối thủ **sau** trận. */
  opponentRatingAfter: z.number().int().min(0),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
});
export type ArenaEnd = z.infer<typeof ArenaEndSchema>;

export const LeaderboardRequestSchema = z.object({
  board: z.enum(LEADERBOARDS),
  limit: z.number().int().min(1).max(LEADERBOARD_MAX_ENTRIES).default(LEADERBOARD_MAX_ENTRIES),
});
export type LeaderboardRequest = z.infer<typeof LeaderboardRequestSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().min(1),
  name: z.string().min(1),
  level: z.number().int().min(1),
  school: z.enum(SCHOOLS),
  class: z.enum(CLASSES),
  /** Chỉ bảng `arena` mới có điểm và thành tích. */
  rating: z.number().int().min(0).optional(),
  wins: z.number().int().min(0).optional(),
  losses: z.number().int().min(0).optional(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSchema = z.object({
  board: z.enum(LEADERBOARDS),
  entries: z.array(LeaderboardEntrySchema),
});
export type LeaderboardView = z.infer<typeof LeaderboardSchema>;

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
  [Opcode.C2S_USE_ITEM]: UseItemSchema,
  [Opcode.C2S_EQUIP]: EquipSchema,
  [Opcode.C2S_UNEQUIP]: UnequipSchema,
  [Opcode.C2S_SHOP_BUY]: ShopBuySchema,
  [Opcode.C2S_SHOP_SELL]: ShopSellSchema,
  [Opcode.C2S_UPGRADE]: UpgradeSchema,
  [Opcode.C2S_ATTACK_MOB]: AttackMobSchema,
  [Opcode.C2S_BATTLE_ACTION]: BattleActionSchema,
  [Opcode.C2S_QUEST_ACCEPT]: QuestAcceptSchema,
  [Opcode.C2S_QUEST_COMPLETE]: QuestCompleteSchema,
  [Opcode.C2S_FRIEND_REQUEST]: PersonNameSchema,
  [Opcode.C2S_FRIEND_ACCEPT]: PersonNameSchema,
  [Opcode.C2S_FRIEND_DECLINE]: PersonNameSchema,
  [Opcode.C2S_FRIEND_REMOVE]: PersonNameSchema,
  [Opcode.C2S_PARTY_INVITE]: PartyInviteSchema,
  [Opcode.C2S_PARTY_ACCEPT]: PartyReplySchema,
  [Opcode.C2S_PARTY_DECLINE]: PartyReplySchema,
  [Opcode.C2S_PARTY_LEAVE]: z.object({}),
  [Opcode.C2S_PARTY_KICK]: PartyKickSchema,
  [Opcode.C2S_MAIL_CLAIM]: MailClaimSchema,
  [Opcode.C2S_ARENA_QUEUE]: z.object({}),
  [Opcode.C2S_ARENA_CANCEL]: z.object({}),
  [Opcode.C2S_LEADERBOARD]: LeaderboardRequestSchema,
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
  [Opcode.S2C_CHARACTER]: CharacterStatsSchema,
  [Opcode.S2C_LEVEL_UP]: LevelUpSchema,
  [Opcode.S2C_INVENTORY_UPDATE]: InventoryUpdateSchema,
  [Opcode.S2C_EQUIPMENT]: EquipmentUpdateSchema,
  [Opcode.S2C_UPGRADE_RESULT]: UpgradeResultSchema,
  [Opcode.S2C_BATTLE_START]: BattleStartSchema,
  [Opcode.S2C_BATTLE_TURN]: BattleTurnSchema,
  [Opcode.S2C_BATTLE_RESULT]: BattleResultSchema,
  [Opcode.S2C_BATTLE_END]: BattleEndSchema,
  [Opcode.S2C_QUEST_UPDATE]: QuestUpdateSchema,
  [Opcode.S2C_SOCIAL_UPDATE]: SocialUpdateSchema,
  [Opcode.S2C_PARTY_UPDATE]: PartyUpdateSchema,
  [Opcode.S2C_MAILS]: MailsSchema,
  [Opcode.S2C_ARENA_STATE]: ArenaStateSchema,
  [Opcode.S2C_ARENA_END]: ArenaEndSchema,
  [Opcode.S2C_LEADERBOARD]: LeaderboardSchema,
} as const;

/** Mã gói tin mà client được phép gửi (theo đúng bảng ở trên). */
export const CLIENT_OPCODES: readonly number[] = Object.keys(CLIENT_PACKETS).map(Number);
export const SERVER_OPCODES: readonly number[] = Object.keys(SERVER_PACKETS).map(Number);

/** Khoảng cách tối đa cho một lệnh di chuyển, dùng chung cho kiểm tra phía client và server. */
export const MAX_MOVE_DISTANCE = MAX_MOVE_DISTANCE_PX;

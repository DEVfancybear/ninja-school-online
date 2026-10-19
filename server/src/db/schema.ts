import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  CLASSES,
  EQUIP_SLOTS,
  QUEST_STATUSES,
  SCHOOLS,
  type EquipSlot,
  type QuestStatus,
} from '@ninja/shared';

const schoolValues = sql.raw(SCHOOLS.map((s) => `'${s}'`).join(', '));
const classValues = sql.raw(CLASSES.map((c) => `'${c}'`).join(', '));
const equipSlotValues = sql.raw(EQUIP_SLOTS.map((s) => `'${s}'`).join(', '));

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    email: varchar('email', { length: 254 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_username_lower_unique').on(sql`lower(${table.username})`),
    check('accounts_status_valid', sql`${table.status} in ('active', 'banned')`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_unique').on(table.tokenHash),
    index('refresh_tokens_account_idx').on(table.accountId),
  ],
);

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 24 }).notNull(),
    school: varchar('school', { length: 16 }).notNull(),
    class: varchar('class', { length: 16 }).notNull(),
    level: integer('level').notNull().default(1),
    exp: integer('exp').notNull().default(0),
    yen: integer('yen').notNull().default(0),
    /**
     * Máu và nội lực hiện tại. `null` nghĩa là **đang đầy**: nhân vật mới tạo, hoặc vừa hồi sinh
     * được hồi đầy máu. Giá trị tối đa suy từ chỉ số phái trong `game-data/classes/` nên không lưu
     * ở đây — đổi chỉ số phái không cần migration dữ liệu.
     */
    hp: integer('hp'),
    mp: integer('mp'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('characters_name_lower_unique').on(sql`lower(${table.name})`),
    index('characters_account_idx').on(table.accountId),
    check('characters_school_valid', sql`${table.school} in (${schoolValues})`),
    check('characters_class_valid', sql`${table.class} in (${classValues})`),
    check('characters_level_positive', sql`${table.level} >= 1`),
    check('characters_exp_non_negative', sql`${table.exp} >= 0`),
    check('characters_yen_non_negative', sql`${table.yen} >= 0`),
    check('characters_hp_non_negative', sql`${table.hp} is null or ${table.hp} >= 0`),
    check('characters_mp_non_negative', sql`${table.mp} is null or ${table.mp} >= 0`),
  ],
);

/** Hàng trong database của một nhân vật, kèm máu/nội lực mà `Character` (gói tin REST) không có. */
export type CharacterRow = typeof characters.$inferSelect;

/**
 * Túi đồ. Mỗi hàng là một loại vật phẩm (gộp số lượng), khớp cách hiển thị của túi: một dòng một
 * vật phẩm kèm số lượng. Sức chứa đếm theo **số loại**, xem `INVENTORY_CAPACITY`.
 *
 * Mỗi nhân vật chỉ có **một bản** của mỗi loại (`inventory_items_character_item_unique`), nên món
 * trang bị đang mặc nằm ngay trên hàng này với `equipped_slot` khác `null` — túi chỉ gồm các hàng
 * có `equipped_slot is null`, và mặc vào thì món rời túi chứ không sinh hàng thứ hai.
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    itemId: varchar('item_id', { length: 64 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** Cấp cường hóa hiện tại; `0` là món chưa cường hóa. Chỉ trang bị mới lên được cấp > 0. */
    upgradeLevel: integer('upgrade_level').notNull().default(0),
    /** Ô đang mặc; `null` là đang nằm trong túi. Mỗi ô chỉ một món (xem index bên dưới). */
    equippedSlot: varchar('equipped_slot', { length: 16 }).$type<EquipSlot>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_items_character_item_unique').on(table.characterId, table.itemId),
    // Một ô chỉ một món. Index **một phần** vì `null` (đang trong túi) không phải là một ô.
    uniqueIndex('inventory_items_character_slot_unique')
      .on(table.characterId, table.equippedSlot)
      .where(sql`${table.equippedSlot} is not null`),
    index('inventory_items_character_idx').on(table.characterId),
    check('inventory_items_quantity_positive', sql`${table.quantity} > 0`),
    check('inventory_items_upgrade_level_non_negative', sql`${table.upgradeLevel} >= 0`),
    check(
      'inventory_items_equipped_slot_valid',
      sql`${table.equippedSlot} is null or ${table.equippedSlot} in (${equipSlotValues})`,
    ),
  ],
);

/** Ba loại giao dịch được ghi vào nhật ký; mỗi loại một mã riêng để lọc sổ dễ. */
export const TRANSACTION_KINDS = ['buy', 'sell', 'upgrade'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const transactionKindValues = sql.raw(TRANSACTION_KINDS.map((kind) => `'${kind}'`).join(', '));

/**
 * Nhật ký giao dịch (audit log). Mỗi lần **thành công** một giao dịch mua/bán/cường hóa ghi đúng
 * một hàng: ai, món gì, bao nhiêu, yên tăng hay giảm, và câu giải thích cho người đọc sổ. Giao dịch
 * bị từ chối thì không ghi gì — chúng không đổi trạng thái của ai.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).$type<TransactionKind>().notNull(),
    itemId: varchar('item_id', { length: 64 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** Yên tăng (bán) hay giảm (mua, cường hóa) so với trước giao dịch. */
    yenDelta: integer('yen_delta').notNull(),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('transactions_character_created_idx').on(table.characterId, table.createdAt),
    check('transactions_quantity_positive', sql`${table.quantity} > 0`),
    check('transactions_kind_valid', sql`${table.kind} in (${transactionKindValues})`),
  ],
);

export type InventoryRow = typeof inventoryItems.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;

const questStatusValues = sql.raw(QUEST_STATUSES.map((status) => `'${status}'`).join(', '));

/**
 * Nhiệm vụ nhân vật **đã nhận** — một hàng cho mỗi nhiệm vụ, không phải một hàng cho mỗi mục tiêu.
 *
 * `progress` giữ số đếm của các mục tiêu `talk`/`kill`/`reach`, xếp đúng thứ tự trong file nhiệm vụ
 * (mục tiêu thứ i ↔ phần tử thứ i). Mục tiêu `collect` **không** lưu ở đây vì nó luôn được đếm lại
 * từ túi: người chơi nhặt thêm hay tiêu bớt món thì nhiệm vụ phải thấy ngay, không cần ghi lại.
 * Nhờ tiến độ nằm trong database, thoát giữa chừng rồi vào lại vẫn còn nguyên.
 */
export const characterQuests = pgTable(
  'character_quests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    questId: varchar('quest_id', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).$type<QuestStatus>().notNull().default('active'),
    progress: jsonb('progress')
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('character_quests_character_quest_unique').on(table.characterId, table.questId),
    index('character_quests_character_status_idx').on(table.characterId, table.status),
    check('character_quests_status_valid', sql`${table.status} in (${questStatusValues})`),
    // Nhiệm vụ đang làm thì chưa có mốc trả; nhiệm vụ đã trả thì phải có mốc trả.
    check(
      'character_quests_completed_at_matches_status',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
  ],
);

/**
 * Cờ tính năng mở khóa bằng nhiệm vụ (`unlocks`). Một hàng cho mỗi cờ, ghi lúc trả nhiệm vụ; cờ đã
 * có thì không ghi lại, nên trả lại nhiệm vụ (nếu có) cũng không sinh hàng thứ hai.
 */
export const characterFeatures = pgTable(
  'character_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    feature: varchar('feature', { length: 32 }).notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('character_features_character_feature_unique').on(table.characterId, table.feature),
    index('character_features_character_idx').on(table.characterId),
  ],
);

export type CharacterQuestRow = typeof characterQuests.$inferSelect;
export type CharacterFeatureRow = typeof characterFeatures.$inferSelect;

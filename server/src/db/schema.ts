import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { CLASSES, SCHOOLS } from '@ninja/shared';

const schoolValues = sql.raw(SCHOOLS.map((s) => `'${s}'`).join(', '));
const classValues = sql.raw(CLASSES.map((c) => `'${c}'`).join(', '));

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_items_character_item_unique').on(table.characterId, table.itemId),
    index('inventory_items_character_idx').on(table.characterId),
    check('inventory_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);


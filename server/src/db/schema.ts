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
  ],
);

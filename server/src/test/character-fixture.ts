import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { EquipSlot } from '@ninja/shared';
import {
  accounts,
  characters,
  inventoryItems,
  transactions,
  type TransactionRow,
} from '../db/schema.js';
import { getTestDb } from './database.js';

let sequence = 0;

/**
 * Nhân vật cho test tầng service: ghi thẳng vào database nên kiểm soát được yên/cấp mà không phải
 * đi qua REST, và **không** có quà khởi đầu của phái — test tự cất đúng món nó cần kiểm.
 */
export async function makeCharacter(
  options: { readonly yen?: number; readonly level?: number } = {},
): Promise<string> {
  const db = await getTestDb();
  sequence += 1;
  const tag = `${sequence}${randomUUID().slice(0, 6)}`;
  const [account] = await db
    .insert(accounts)
    .values({ username: `fixture_${tag}`, passwordHash: '$argon2id$fixture' })
    .returning();
  const [character] = await db
    .insert(characters)
    .values({
      accountId: account!.id,
      name: `Nhan vat ${tag}`,
      school: 'haruna',
      class: 'dao',
      level: options.level ?? 1,
      yen: options.yen ?? 200,
    })
    .returning();
  return character!.id;
}

/** Cất sẵn một món cho nhân vật (kể cả đang mặc) để test đúng luật cần kiểm. */
export async function giveItem(
  characterId: string,
  itemId: string,
  options: {
    readonly quantity?: number;
    readonly upgradeLevel?: number;
    readonly slot?: EquipSlot | null;
  } = {},
): Promise<void> {
  const db = await getTestDb();
  await db.insert(inventoryItems).values({
    characterId,
    itemId,
    quantity: options.quantity ?? 1,
    upgradeLevel: options.upgradeLevel ?? 0,
    equippedSlot: options.slot ?? null,
  });
}

/** Cất nhiều loại món khác nhau, mỗi loại một món — dùng để làm đầy túi. */
export async function fillBag(
  characterId: string,
  kinds: number,
  prefix = 'item-filler',
): Promise<void> {
  for (let index = 1; index <= kinds; index += 1) {
    await giveItem(characterId, `${prefix}-${String(index).padStart(2, '0')}`);
  }
}

/** Số yên đang lưu trong database. */
export async function readYen(characterId: string): Promise<number> {
  const db = await getTestDb();
  const [row] = await db
    .select({ yen: characters.yen })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return row?.yen ?? 0;
}

/** Hàng của một món trong `inventory_items` (cả đang mặc), hoặc `undefined` nếu không có. */
export async function readItemRow(
  characterId: string,
  itemId: string,
): Promise<
  | {
      readonly quantity: number;
      readonly upgradeLevel: number;
      readonly equippedSlot: EquipSlot | null;
    }
  | undefined
> {
  const db = await getTestDb();
  const [row] = await db
    .select({
      quantity: inventoryItems.quantity,
      upgradeLevel: inventoryItems.upgradeLevel,
      equippedSlot: inventoryItems.equippedSlot,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)))
    .limit(1);
  return row;
}

/** Nhật ký giao dịch của nhân vật, theo thứ tự đã ghi. */
export async function readTransactions(characterId: string): Promise<TransactionRow[]> {
  const db = await getTestDb();
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.characterId, characterId))
    .orderBy(asc(transactions.createdAt));
}

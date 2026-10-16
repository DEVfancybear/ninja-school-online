import { and, asc, eq, sql } from 'drizzle-orm';
import { INVENTORY_CAPACITY, type InventoryItem, type InventoryUpdate } from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { inventoryItems } from '../../db/schema.js';
import type { GameData } from '../../world/game-data.js';

/** Một dòng trong túi: loại vật phẩm và số lượng đang có. */
export interface InventoryEntry {
  readonly itemId: string;
  readonly quantity: number;
}

/** Kết quả cất vật phẩm vào túi. Mọi lý do không cất được đều có tên riêng để người gọi xử lý. */
export type GrantResult = 'ok' | 'inventory_full' | 'unknown_item';

/**
 * Túi đồ: nguồn sự thật nằm ở bảng `inventory_items`, tên/mô tả/hiệu ứng lấy từ `game-data`.
 * Sức chứa tính theo **số loại** vật phẩm (`INVENTORY_CAPACITY`), không theo tổng số lượng.
 */
export class InventoryService {
  constructor(
    private readonly db: Db,
    private readonly gameData: GameData,
  ) {}

  /** Toàn bộ túi, theo thứ tự nhận được (món nhặt trước ở trên). */
  async list(characterId: string): Promise<InventoryEntry[]> {
    const rows = await this.db
      .select({ itemId: inventoryItems.itemId, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, characterId))
      .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.itemId));
    return rows;
  }

  /** Số loại vật phẩm đang có trong túi. */
  async countKinds(characterId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, characterId));
    return row?.total ?? 0;
  }

  /**
   * Cất `quantity` món vào túi. Vật phẩm chưa có trong túi thì cần một ô trống; túi đầy thì trả
   * `inventory_full` và **không** cất gì (đồ rơi bị mất, người chơi tự dọn túi).
   */
  async grant(characterId: string, itemId: string, quantity = 1): Promise<GrantResult> {
    if (quantity <= 0) {
      return 'ok';
    }
    if (!this.gameData.items.has(itemId)) {
      // Không thể xảy ra: `checkGameData` bắt mọi quà rơi trỏ tới vật phẩm có thật.
      return 'unknown_item';
    }

    const existing = await this.db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)))
      .limit(1);

    if (existing.length === 0 && (await this.countKinds(characterId)) >= INVENTORY_CAPACITY) {
      return 'inventory_full';
    }

    await this.db
      .insert(inventoryItems)
      .values({ characterId, itemId, quantity })
      .onConflictDoUpdate({
        target: [inventoryItems.characterId, inventoryItems.itemId],
        set: { quantity: sql`${inventoryItems.quantity} + ${quantity}` },
      });
    return 'ok';
  }

  /** Cất nhiều món một lượt (đồ khởi đầu của phái), bỏ qua món không cất được. */
  async grantItems(
    characterId: string,
    items: readonly { readonly itemId: string; readonly qty: number }[],
  ): Promise<void> {
    for (const item of items) {
      await this.grant(characterId, item.itemId, item.qty);
    }
  }

  /**
   * Lấy `quantity` món ra khỏi túi. Trả `false` nếu không đủ số lượng — người gọi phải kiểm trước
   * rồi mới dùng hiệu ứng, để không bao giờ dùng được món mình không có.
   */
  async take(characterId: string, itemId: string, quantity = 1): Promise<boolean> {
    const [row] = await this.db
      .update(inventoryItems)
      .set({ quantity: sql`${inventoryItems.quantity} - ${quantity}` })
      .where(
        and(
          eq(inventoryItems.characterId, characterId),
          eq(inventoryItems.itemId, itemId),
          sql`${inventoryItems.quantity} >= ${quantity}`,
        ),
      )
      .returning({ quantity: inventoryItems.quantity });

    if (!row) {
      return false;
    }
    if (row.quantity <= 0) {
      await this.db
        .delete(inventoryItems)
        .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)));
    }
    return true;
  }

  /** Số lượng đang có của một vật phẩm (`0` là không có). */
  async count(characterId: string, itemId: string): Promise<number> {
    const [row] = await this.db
      .select({ quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)))
      .limit(1);
    return row?.quantity ?? 0;
  }

  /** Gói `S2C_INVENTORY_UPDATE`: túi hiện tại, đã kèm tên và hiệu ứng để client hiện thẳng. */
  async toPacket(characterId: string): Promise<InventoryUpdate> {
    const entries = await this.list(characterId);
    const items: InventoryItem[] = [];
    for (const entry of entries) {
      const item = this.gameData.items.get(entry.itemId);
      if (!item) {
        continue;
      }
      const effect = item.kind === 'consumable' ? item.consumable : null;
      items.push({
        itemId: item.id,
        name: item.name,
        kind: item.kind,
        quantity: entry.quantity,
        usable: effect !== null && (effect.healHp > 0 || effect.healMp > 0),
        description: item.description,
        ...(effect && effect.healHp > 0 ? { healHp: effect.healHp } : {}),
        ...(effect && effect.healMp > 0 ? { healMp: effect.healMp } : {}),
      });
    }
    return { items, capacity: INVENTORY_CAPACITY };
  }
}

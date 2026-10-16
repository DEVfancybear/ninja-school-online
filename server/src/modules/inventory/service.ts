import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  INVENTORY_CAPACITY,
  sellPrice,
  statsAtUpgradeLevel,
  upgradeMaxLevelOf,
  type EquipSlot,
  type InventoryItem,
  type InventoryUpdate,
  type Item,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { inventoryItems } from '../../db/schema.js';
import type { GameData } from '../../world/game-data.js';

/**
 * Một hàng trong `inventory_items` đủ để dựng gói tin: món, số lượng, cấp cường hóa và ô đang mặc.
 * `equippedSlot` khác `null` nghĩa là món **không** nằm trong túi (xem `list`).
 */
export interface InventoryRow {
  readonly itemId: string;
  readonly quantity: number;
  readonly upgradeLevel: number;
  readonly equippedSlot: EquipSlot | null;
}

/**
 * Dựng một mục của gói túi đồ / trang bị từ dữ liệu game-data và hàng trong database. Tên, chỉ số
 * và giá đều lấy từ `game-data`: client không phải đọc dữ liệu game, và hai gói tin dùng chung một
 * cách dựng nên món đang mặc hiện y hệt món trong túi.
 */
export function inventoryItemView(
  item: Item,
  row: { readonly quantity: number; readonly upgradeLevel: number },
): InventoryItem {
  const effect = item.kind === 'consumable' ? item.consumable : null;
  return {
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    quantity: row.quantity,
    usable: effect !== null && (effect.healHp > 0 || effect.healMp > 0),
    description: item.description,
    ...(effect && effect.healHp > 0 ? { healHp: effect.healHp } : {}),
    ...(effect && effect.healMp > 0 ? { healMp: effect.healMp } : {}),
    slot: item.slot,
    upgradeLevel: row.upgradeLevel,
    stats: statsAtUpgradeLevel(item.stats, row.upgradeLevel),
    levelRequired: item.levelRequired,
    price: item.price,
    sellPrice: sellPrice(item.price),
    upgradeMaxLevel: upgradeMaxLevelOf(item.upgradeMaxLevel),
  };
}

/** Kết quả cất vật phẩm vào túi. Mọi lý do không cất được đều có tên riêng để người gọi xử lý. */
export type GrantResult = 'ok' | 'inventory_full' | 'unknown_item';

/**
 * Túi đồ: nguồn sự thật nằm ở bảng `inventory_items`, tên/mô tả/hiệu ứng lấy từ `game-data`.
 * Sức chứa tính theo **số loại** vật phẩm (`INVENTORY_CAPACITY`), không theo tổng số lượng.
 *
 * Từ M4, một hàng còn biết mình đang ở ô nào: **túi** là các hàng có `equipped_slot is null`. Món
 * đang mặc không chiếm ô túi, nên mặc/tháo chỉ là đổi `equipped_slot` của đúng hàng đó — không bao
 * giờ sinh hàng thứ hai và không bao giờ tràn túi.
 */
export class InventoryService {
  constructor(
    private readonly db: Db,
    private readonly gameData: GameData,
  ) {}

  /** **Túi** của nhân vật (không gồm món đang mặc), theo thứ tự nhận được (món nhặt trước ở trên). */
  async list(characterId: string): Promise<InventoryRow[]> {
    return this.db
      .select({
        itemId: inventoryItems.itemId,
        quantity: inventoryItems.quantity,
        upgradeLevel: inventoryItems.upgradeLevel,
        equippedSlot: inventoryItems.equippedSlot,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), isNull(inventoryItems.equippedSlot)))
      .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.itemId));
  }

  /** Món đang mặc (đủ mọi ô) — dùng để cộng chỉ số và dựng gói `S2C_EQUIPMENT`. */
  async equippedRows(characterId: string): Promise<InventoryRow[]> {
    const rows = await this.db
      .select({
        itemId: inventoryItems.itemId,
        quantity: inventoryItems.quantity,
        upgradeLevel: inventoryItems.upgradeLevel,
        equippedSlot: inventoryItems.equippedSlot,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId)))
      .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.itemId));
    return rows.filter((row) => row.equippedSlot !== null);
  }

  /** Một hàng theo món, **bất kể** đang trong túi hay đang mặc. */
  async findRow(characterId: string, itemId: string): Promise<InventoryRow | undefined> {
    const [row] = await this.db
      .select({
        itemId: inventoryItems.itemId,
        quantity: inventoryItems.quantity,
        upgradeLevel: inventoryItems.upgradeLevel,
        equippedSlot: inventoryItems.equippedSlot,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)))
      .limit(1);
    return row;
  }

  /** Số loại vật phẩm **trong túi** (món đang mặc không tính là một ô túi). */
  async countKinds(characterId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), isNull(inventoryItems.equippedSlot)));
    return row?.total ?? 0;
  }

  /** Đặt món vào một ô (`null` = trả về túi). Chỉ người gọi đã kiểm luật mới được dùng. */
  async setEquippedSlot(characterId: string, itemId: string, slot: EquipSlot | null): Promise<void> {
    await this.db
      .update(inventoryItems)
      .set({ equippedSlot: slot })
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)));
  }

  /** Dọn món đang chiếm một ô về túi — gọi **trước** khi mặc món khác vào ô đó. */
  async clearSlot(characterId: string, slot: EquipSlot): Promise<void> {
    await this.db
      .update(inventoryItems)
      .set({ equippedSlot: null })
      .where(
        and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.equippedSlot, slot)),
      );
  }

  /** Ghi cấp cường hóa mới của một món. */
  async setUpgradeLevel(characterId: string, itemId: string, upgradeLevel: number): Promise<void> {
    await this.db
      .update(inventoryItems)
      .set({ upgradeLevel })
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)));
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
   * Lấy `quantity` món **trong túi** ra. Trả `false` nếu không đủ số lượng — người gọi phải kiểm
   * trước rồi mới dùng hiệu ứng/bán, để không bao giờ tiêu được món mình không có. Món đang mặc
   * không lấy được ở đây: muốn bán nó thì phải tháo ra trước (`item_equipped`).
   */
  async take(characterId: string, itemId: string, quantity = 1): Promise<boolean> {
    // Lấy một phần và lấy hết là hai câu lệnh riêng vì bảng có ràng buộc `quantity > 0`: không thể
    // trừ xuống 0 rồi mới xoá hàng, câu `update` sẽ vi phạm ràng buộc và ném lỗi.
    const [row] = await this.db
      .update(inventoryItems)
      .set({ quantity: sql`${inventoryItems.quantity} - ${quantity}` })
      .where(
        and(
          eq(inventoryItems.characterId, characterId),
          eq(inventoryItems.itemId, itemId),
          isNull(inventoryItems.equippedSlot),
          sql`${inventoryItems.quantity} > ${quantity}`,
        ),
      )
      .returning({ quantity: inventoryItems.quantity });
    if (row) {
      return true;
    }

    const removed = await this.db
      .delete(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, characterId),
          eq(inventoryItems.itemId, itemId),
          isNull(inventoryItems.equippedSlot),
          eq(inventoryItems.quantity, quantity),
        ),
      )
      .returning({ itemId: inventoryItems.itemId });
    return removed.length > 0;
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

  /** Gói `S2C_INVENTORY_UPDATE`: **túi** hiện tại, đã kèm tên, chỉ số và giá để client hiện thẳng. */
  async toPacket(characterId: string): Promise<InventoryUpdate> {
    const entries = await this.list(characterId);
    const items: InventoryItem[] = [];
    for (const entry of entries) {
      const item = this.gameData.items.get(entry.itemId);
      if (!item) {
        continue;
      }
      items.push(inventoryItemView(item, entry));
    }
    return { items, capacity: INVENTORY_CAPACITY };
  }
}

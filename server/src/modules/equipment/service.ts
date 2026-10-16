import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABELS,
  ErrorCode,
  statsAtUpgradeLevel,
  sumStats,
  type EquipmentUpdate,
  type EquipSlot,
  type StatBlock,
} from '@ninja/shared';
import type { CharacterService } from '../character/service.js';
import { NO_STATS_BONUS } from '../character/stats.js';
import {
  inventoryItemView,
  type InventoryRow,
  type InventoryService,
} from '../inventory/service.js';
import type { GameData } from '../../world/game-data.js';

/** Kết quả một thao tác trang bị: hoặc xong, hoặc bị từ chối kèm mã lỗi và câu tiếng Việt. */
export type EquipOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

const DONE: EquipOutcome = { ok: true };

/**
 * Trang bị theo ô. Món đang mặc vẫn là **một hàng** trong `inventory_items`, chỉ khác là có
 * `equipped_slot`: mặc vào là hàng đó rời túi, tháo ra là nó về túi. Vì vậy mặc và tháo không bao
 * giờ làm tràn túi — chúng chỉ hoán đổi một loại giữa túi và ô.
 */
export class EquipmentService {
  constructor(
    private readonly gameData: GameData,
    private readonly characters: CharacterService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * `C2S_EQUIP`: mặc một món **đang có** (trong túi) vào ô của nó. Ô đang có món khác thì món cũ tự
   * về túi. Kiểm cấp trước khi đổi gì để thao tác bị từ chối không để lại dấu vết.
   */
  async equip(characterId: string, itemId: string): Promise<EquipOutcome> {
    const row = await this.inventory.findRow(characterId, itemId);
    if (!row) {
      return reject(ErrorCode.ITEM_NOT_OWNED, 'bạn không có món này');
    }

    const item = this.gameData.items.get(itemId);
    if (!item || item.slot === null) {
      return reject(ErrorCode.NOT_EQUIPPABLE, `${item?.name ?? itemId} không mặc được`);
    }

    const record = await this.characters.findById(characterId);
    if (!record) {
      return reject(ErrorCode.NO_CHARACTER, 'không đọc được nhân vật của bạn, hãy vào lại');
    }
    if (record.level < item.levelRequired) {
      return reject(
        ErrorCode.LEVEL_TOO_LOW,
        `cần cấp ${item.levelRequired} mới mặc được ${item.name} (bạn đang cấp ${record.level})`,
      );
    }

    // Dọn ô trước rồi mới mặc: index `inventory_items_character_slot_unique` chỉ cho một món mỗi ô,
    // và theo thứ tự này thì hai câu lệnh không bao giờ chồng ô.
    await this.inventory.clearSlot(characterId, item.slot);
    await this.inventory.setEquippedSlot(characterId, itemId, item.slot);
    return DONE;
  }

  /** `C2S_UNEQUIP`: tháo món ở một ô ra túi. Ô trống thì coi như chưa sở hữu món nào. */
  async unequip(characterId: string, slot: EquipSlot): Promise<EquipOutcome> {
    const row = await this.wornIn(characterId, slot);
    if (!row) {
      return reject(ErrorCode.ITEM_NOT_OWNED, `ô ${EQUIP_SLOT_LABELS[slot]} đang trống`);
    }

    await this.inventory.setEquippedSlot(characterId, row.itemId, null);
    return DONE;
  }

  /**
   * Gói `S2C_EQUIPMENT`: **luôn** đủ 4 ô theo thứ tự `EQUIP_SLOTS` (ô trống có `item: null`) để
   * client vẽ được bảng trang bị mà không phải tự suy ô nào thiếu.
   */
  async toPacket(characterId: string): Promise<EquipmentUpdate> {
    const rows = await this.inventory.equippedRows(characterId);
    const worn = new Map<EquipSlot, InventoryRow>();
    for (const row of rows) {
      if (row.equippedSlot !== null) {
        worn.set(row.equippedSlot, row);
      }
    }

    return {
      slots: EQUIP_SLOTS.map((slot) => {
        const row = worn.get(slot);
        const item = row ? this.gameData.items.get(row.itemId) : undefined;
        return { slot, item: row && item ? inventoryItemView(item, row) : null };
      }),
    };
  }

  /**
   * Tổng chỉ số của đồ đang mặc, đã tính cường hóa. Chỉ số này được cộng vào chỉ số nhân vật ở HUD
   * (`S2C_CHARACTER`) **và** ở ảnh chụp lúc vào trận, nên mặc đồ là mạnh lên thật trong trận.
   */
  async bonusFor(characterId: string): Promise<StatBlock> {
    const rows = await this.inventory.equippedRows(characterId);
    const blocks: StatBlock[] = [];
    for (const row of rows) {
      const item = this.gameData.items.get(row.itemId);
      if (item) {
        blocks.push(statsAtUpgradeLevel(item.stats, row.upgradeLevel));
      }
    }
    return blocks.length === 0 ? NO_STATS_BONUS : sumStats(blocks);
  }

  private async wornIn(characterId: string, slot: EquipSlot): Promise<InventoryRow | undefined> {
    const rows = await this.inventory.equippedRows(characterId);
    return rows.find((row) => row.equippedSlot === slot);
  }
}

function reject(code: ErrorCode, message: string): EquipOutcome {
  return { ok: false, code, message };
}

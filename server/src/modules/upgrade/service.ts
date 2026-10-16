import {
  ErrorCode,
  UPGRADE_MATERIAL_ID,
  UPGRADE_MATERIAL_QTY,
  upgradeMaxLevelOf,
  upgradeSuccessRate,
  upgradeYenCost,
  type UpgradeResult,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { logTransaction } from '../../db/transactions.js';
import type { CharacterService } from '../character/service.js';
import type { InventoryService } from '../inventory/service.js';
import type { GameData } from '../../world/game-data.js';

/** Nguồn ngẫu nhiên của một lần thử; tiêm được để test ép thành công (`() => 0`) hay thất bại (`() => 1`). */
export type Rng = () => number;

/** Kết quả một lần cường hóa: hoặc có `UpgradeResult` để gửi đi, hoặc lý do từ chối. */
export type UpgradeOutcome =
  | { readonly ok: true; readonly result: UpgradeResult }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * Cường hóa trang bị +1 → +5. Mỗi lần thử **luôn** mất yên và đá (kể cả khi thất bại), còn cấp của
 * món thì chỉ tăng khi gieo thành công — thất bại không tụt cấp và không mất món.
 */
export class UpgradeService {
  constructor(
    private readonly db: Db,
    private readonly gameData: GameData,
    private readonly characters: CharacterService,
    private readonly inventory: InventoryService,
  ) {}

  async upgrade(
    characterId: string,
    itemId: string,
    rng: Rng = Math.random,
  ): Promise<UpgradeOutcome> {
    const row = await this.inventory.findRow(characterId, itemId);
    if (!row) {
      return reject(ErrorCode.ITEM_NOT_OWNED, 'bạn không có món này');
    }

    const item = this.gameData.items.get(itemId);
    const maxLevel = item ? upgradeMaxLevelOf(item.upgradeMaxLevel) : 0;
    if (!item || item.slot === null || maxLevel === 0) {
      return reject(ErrorCode.NOT_UPGRADABLE, `${item?.name ?? itemId} không cường hóa được`);
    }
    if (row.upgradeLevel >= maxLevel) {
      return reject(ErrorCode.UPGRADE_MAXED, `${item.name} đã đạt cấp cao nhất (+${maxLevel})`);
    }

    const cost = upgradeYenCost(row.upgradeLevel);
    const rate = upgradeSuccessRate(row.upgradeLevel);
    const materialName = this.gameData.items.get(UPGRADE_MATERIAL_ID)?.name ?? UPGRADE_MATERIAL_ID;

    // Trừ yên và đá **trước** khi gieo: mỗi lần thử là một lần trả giá, thành công hay không.
    const yen = await this.characters.spendYen(characterId, cost);
    if (yen === undefined) {
      return reject(
        ErrorCode.NOT_ENOUGH_YEN,
        `không đủ yên: cường hóa ${item.name} từ +${row.upgradeLevel} tốn ${cost} yên`,
      );
    }
    if (!(await this.inventory.take(characterId, UPGRADE_MATERIAL_ID, UPGRADE_MATERIAL_QTY))) {
      // Chưa đủ nguyên liệu thì chưa tính là một lần thử: trả lại yên rồi mới báo lỗi.
      await this.characters.addYen(characterId, cost);
      return reject(
        ErrorCode.NOT_ENOUGH_MATERIAL,
        `cần ${UPGRADE_MATERIAL_QTY} ${materialName} để cường hóa ${item.name}`,
      );
    }

    const success = rng() < rate;
    const upgradeLevel = success ? row.upgradeLevel + 1 : row.upgradeLevel;
    if (success) {
      await this.inventory.setUpgradeLevel(characterId, itemId, upgradeLevel);
    }

    const spent = `${cost} yên và ${UPGRADE_MATERIAL_QTY} ${materialName}`;
    const message = success
      ? `Cường hóa thành công: ${item.name} +${row.upgradeLevel} lên +${upgradeLevel}, mất ${spent} (còn ${yen} yên)`
      : `Cường hóa thất bại: ${item.name} giữ nguyên +${upgradeLevel}, mất ${spent} (còn ${yen} yên)`;

    await logTransaction(this.db, {
      characterId,
      kind: 'upgrade',
      itemId,
      quantity: UPGRADE_MATERIAL_QTY,
      yenDelta: -cost,
      detail: message,
    });

    return {
      ok: true,
      result: {
        itemId: item.id,
        name: item.name,
        success,
        upgradeLevel,
        previousLevel: row.upgradeLevel,
        successRate: rate,
        yenCost: cost,
        materialQty: UPGRADE_MATERIAL_QTY,
        message,
      },
    };
  }
}

function reject(code: ErrorCode, message: string): UpgradeOutcome {
  return { ok: false, code, message };
}

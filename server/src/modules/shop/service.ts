import {
  ErrorCode,
  INVENTORY_CAPACITY,
  SELL_PRICE_RATIO,
  sellPrice,
  upgradeMaxLevelOf,
  type Npc,
  type Shop,
  type ShopEntry,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { logTransaction } from '../../db/transactions.js';
import type { CharacterService } from '../character/service.js';
import type { InventoryService } from '../inventory/service.js';
import type { GameData } from '../../world/game-data.js';

/**
 * Hợp đồng M4 không có mã lỗi riêng cho "túi đầy" (`shared/` đã chốt), nên dùng mã từ chối chung
 * `bad_packet` kèm câu tiếng Việt nói rõ túi đầy. Nếu sau này `shared/` thêm mã riêng thì đổi ở đây.
 */
const BAG_FULL_CODE = ErrorCode.BAD_PACKET;

/** Kết quả một giao dịch shop: xong thì kèm số yên mới để gửi thông báo, không thì kèm lý do. */
export type ShopOutcome =
  | {
      readonly ok: true;
      /** Yên sau giao dịch. */
      readonly yen: number;
      /** Âm khi mua, dương khi bán. */
      readonly yenDelta: number;
      readonly quantity: number;
      /** Câu tiếng Việt gửi cho người chơi qua `S2C_NOTIFY`. */
      readonly message: string;
    }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * Shop của NPC: mua bằng yên theo giá trong `game-data/items/`, bán lại mọi món trong túi theo
 * `sellPrice` (không cần NPC bán món đó). Mỗi giao dịch thành công ghi một hàng `transactions`.
 */
export class ShopService {
  constructor(
    private readonly db: Db,
    private readonly gameData: GameData,
    private readonly characters: CharacterService,
    private readonly inventory: InventoryService,
  ) {}

  /** Quầy hàng của một NPC: đủ tên, giá, chỉ số để client dựng bảng hàng mà không đọc `game-data`. */
  shopFor(npc: Npc): Shop {
    const entries: ShopEntry[] = [];
    for (const itemId of npc.shop) {
      const item = this.gameData.items.get(itemId);
      if (!item) {
        // Không thể xảy ra: `checkGameData` bắt mọi món NPC bán phải có thật.
        continue;
      }
      const effect = item.kind === 'consumable' ? item.consumable : null;
      entries.push({
        itemId: item.id,
        name: item.name,
        kind: item.kind,
        price: item.price,
        sellPrice: sellPrice(item.price),
        levelRequired: item.levelRequired,
        description: item.description,
        slot: item.slot,
        stats: item.stats,
        upgradeMaxLevel: upgradeMaxLevelOf(item.upgradeMaxLevel),
        ...(effect && effect.healHp > 0 ? { healHp: effect.healHp } : {}),
        ...(effect && effect.healMp > 0 ? { healMp: effect.healMp } : {}),
      });
    }
    return { sellRatio: SELL_PRICE_RATIO, entries };
  }

  /**
   * `C2S_SHOP_BUY`. Trang bị chỉ giữ **một bản** mỗi món (túi unique theo món), nên mua món đã có —
   * kể cả đang mặc — bị từ chối bằng `already_owned`, và mua trang bị luôn là mua một món.
   */
  async buy(characterId: string, npc: Npc, itemId: string, quantity: number): Promise<ShopOutcome> {
    const item = this.gameData.items.get(itemId);
    if (!item || !npc.shop.includes(itemId)) {
      return reject(ErrorCode.NOT_FOR_SALE, `NPC này không bán ${item?.name ?? itemId}`);
    }

    if (item.slot !== null) {
      if (quantity !== 1) {
        return reject(BAG_FULL_CODE, `${item.name} là trang bị, mỗi lần chỉ mua được một món`);
      }
      if (await this.inventory.findRow(characterId, itemId)) {
        return reject(
          ErrorCode.ALREADY_OWNED,
          `bạn đã có ${item.name} rồi — mỗi món trang bị chỉ giữ được một bản`,
        );
      }
    } else if (
      !(await this.inventory.findRow(characterId, itemId)) &&
      (await this.inventory.countKinds(characterId)) >= INVENTORY_CAPACITY
    ) {
      // Món đã có trong túi thì cộng thêm số lượng, không cần ô mới.
      return reject(BAG_FULL_CODE, bagFullMessage());
    }

    const totalYen = item.price * quantity;
    const yen = await this.characters.spendYen(characterId, totalYen);
    if (yen === undefined) {
      return reject(
        ErrorCode.NOT_ENOUGH_YEN,
        `không đủ yên: ${quantity} ${item.name} giá ${totalYen} yên`,
      );
    }

    if ((await this.inventory.grant(characterId, itemId, quantity)) !== 'ok') {
      // Không cất được (túi đầy do đổi trạng thái giữa chừng) thì trả lại yên, không để mất tiền.
      await this.characters.addYen(characterId, totalYen);
      return reject(BAG_FULL_CODE, bagFullMessage());
    }

    const message = `Đã mua ${quantity} ${item.name} hết ${totalYen} yên (còn ${yen} yên)`;
    await logTransaction(this.db, {
      characterId,
      kind: 'buy',
      itemId,
      quantity,
      yenDelta: -totalYen,
      detail: message,
    });
    return { ok: true, yen, yenDelta: -totalYen, quantity, message };
  }

  /**
   * `C2S_SHOP_SELL`: bán món **trong túi** với giá `sellPrice(item.price)`. Món đang mặc bị từ chối
   * (`item_equipped`) — muốn bán phải tháo ra trước, nhờ vậy bán không bao giờ làm rơi mất đồ đang dùng.
   */
  async sell(characterId: string, itemId: string, quantity: number): Promise<ShopOutcome> {
    const item = this.gameData.items.get(itemId);
    const row = await this.inventory.findRow(characterId, itemId);
    if (!item || !row) {
      return reject(ErrorCode.ITEM_NOT_OWNED, 'bạn không có món này trong túi');
    }
    if (row.equippedSlot !== null) {
      return reject(ErrorCode.ITEM_EQUIPPED, `${item.name} đang mặc, hãy tháo ra rồi mới bán`);
    }
    if (!(await this.inventory.take(characterId, itemId, quantity))) {
      return reject(ErrorCode.ITEM_NOT_OWNED, `bạn chỉ có ${row.quantity} ${item.name}`);
    }

    const earned = sellPrice(item.price) * quantity;
    const yen = (await this.characters.addYen(characterId, earned)) ?? 0;
    const message = `Đã bán ${quantity} ${item.name} được ${earned} yên (còn ${yen} yên)`;
    await logTransaction(this.db, {
      characterId,
      kind: 'sell',
      itemId,
      quantity,
      yenDelta: earned,
      detail: message,
    });
    return { ok: true, yen, yenDelta: earned, quantity, message };
  }
}

function bagFullMessage(): string {
  return `túi đồ đã đầy ${INVENTORY_CAPACITY} loại, hãy bán hoặc dùng bớt rồi quay lại`;
}

function reject(code: ErrorCode, message: string): ShopOutcome {
  return { ok: false, code, message };
}

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  INVENTORY_CAPACITY,
  SELL_PRICE_RATIO,
  sellPrice,
  type Npc,
} from '@ninja/shared';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import {
  fillBag,
  giveItem,
  makeCharacter,
  readItemRow,
  readTransactions,
  readYen,
} from '../../test/character-fixture.js';
import { DEFAULT_GAME_DATA_DIR, loadGameData, type GameData } from '../../world/game-data.js';
import { CharacterService } from '../character/service.js';
import { InventoryService } from '../inventory/service.js';
import { ShopService } from './service.js';

const SHOP_NPC_ID = 'npc-thay-do';

let gameData: GameData;
let inventory: InventoryService;
let characters: CharacterService;
let shop: ShopService;
let npc: Npc;
let characterId: string;

beforeEach(async () => {
  await resetDatabase();
  const db = await getTestDb();
  gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  inventory = new InventoryService(db, gameData);
  characters = new CharacterService(db, inventory, gameData);
  shop = new ShopService(db, gameData, characters, inventory);
  npc = gameData.npcs.get(SHOP_NPC_ID)!;
  characterId = await makeCharacter({ yen: 200 });
});

afterAll(async () => {
  await closeTestDb();
});

describe('ShopService.shopFor', () => {
  it('trả đủ món NPC bán, kèm giá bán lại và chỉ số để client hiện thẳng', () => {
    const payload = shop.shopFor(npc);

    expect(payload.sellRatio).toBe(SELL_PRICE_RATIO);
    expect(payload.entries.map((entry) => entry.itemId)).toEqual([...npc.shop]);
    expect(payload.entries[0]).toMatchObject({
      itemId: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      kind: 'weapon',
      price: 100,
      sellPrice: 40,
      slot: 'weapon',
      levelRequired: 1,
      upgradeMaxLevel: 5,
      stats: { strength: 2, agility: 0, spirit: 0, hp: 0, mp: 0 },
    });
    expect(payload.entries.find((entry) => entry.itemId === 'item-banh-bao')).toMatchObject({
      kind: 'consumable',
      healHp: 40,
      slot: null,
    });
  });
});

describe('ShopService.buy', () => {
  it('mua vật phẩm gộp số lượng, trừ yên và ghi một hàng nhật ký', async () => {
    await giveItem(characterId, 'item-banh-bao', { quantity: 1 });

    const outcome = await shop.buy(characterId, npc, 'item-banh-bao', 2);

    expect(outcome).toMatchObject({ ok: true, yen: 140, yenDelta: -60, quantity: 2 });
    expect(outcome.message).toContain('Đã mua 2');
    expect(await readYen(characterId)).toBe(140);
    expect(await readItemRow(characterId, 'item-banh-bao')).toMatchObject({
      quantity: 3,
      equippedSlot: null,
    });

    const log = await readTransactions(characterId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      kind: 'buy',
      itemId: 'item-banh-bao',
      quantity: 2,
      yenDelta: -60,
    });
    expect(log[0]?.detail).toContain('Đã mua 2');
  });

  it('mua trang bị: cất vào túi, mỗi món chỉ một hàng', async () => {
    const outcome = await shop.buy(characterId, npc, 'item-kiem-go', 1);

    expect(outcome).toMatchObject({ ok: true, yen: 100, yenDelta: -100 });
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({
      quantity: 1,
      equippedSlot: null,
    });
    expect(await readTransactions(characterId)).toHaveLength(1);
  });

  it('mua trang bị đã sở hữu (kể cả đang mặc) → already_owned, không mất yên', async () => {
    await shop.buy(characterId, npc, 'item-kiem-go', 1);
    await inventory.setEquippedSlot(characterId, 'item-kiem-go', 'weapon');

    const outcome = await shop.buy(characterId, npc, 'item-kiem-go', 1);

    expect(outcome).toMatchObject({ ok: false, code: ErrorCode.ALREADY_OWNED });
    expect(await readYen(characterId)).toBe(100);
    expect(await readTransactions(characterId)).toHaveLength(1);
  });

  it('mua trang bị với số lượng lớn hơn một bị từ chối', async () => {
    const outcome = await shop.buy(characterId, npc, 'item-kiem-go', 2);

    expect(outcome).toMatchObject({ ok: false });
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-kiem-go')).toBeUndefined();
  });

  it('món NPC không bán → not_for_sale', async () => {
    const outcome = await shop.buy(characterId, npc, 'item-da-vun', 1);

    expect(outcome).toMatchObject({ ok: false, code: ErrorCode.NOT_FOR_SALE });
    expect(await readYen(characterId)).toBe(200);
  });

  it('không đủ yên → not_enough_yen, không đụng túi', async () => {
    const outcome = await shop.buy(characterId, npc, 'item-giap-da', 1);

    expect(outcome).toMatchObject({ ok: false, code: ErrorCode.NOT_ENOUGH_YEN });
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-giap-da')).toBeUndefined();
    expect(await readTransactions(characterId)).toEqual([]);
  });

  it('túi đầy → từ chối và không trừ yên', async () => {
    await fillBag(characterId, INVENTORY_CAPACITY);

    const outcome = await shop.buy(characterId, npc, 'item-banh-bao', 1);

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.message).toContain('túi đồ đã đầy');
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-banh-bao')).toBeUndefined();
  });

  it('túi đầy nhưng món đã có trong túi thì vẫn mua được (cộng số lượng)', async () => {
    await fillBag(characterId, INVENTORY_CAPACITY - 1);
    await giveItem(characterId, 'item-banh-bao');

    const outcome = await shop.buy(characterId, npc, 'item-banh-bao', 2);

    expect(outcome).toMatchObject({ ok: true, yen: 140 });
    expect(await readItemRow(characterId, 'item-banh-bao')).toMatchObject({ quantity: 3 });
  });
});

describe('ShopService.sell', () => {
  it('bán món trong túi: yên tăng đúng giá bán lại và ghi nhật ký', async () => {
    await giveItem(characterId, 'item-kiem-go');
    const expected = sellPrice(gameData.items.get('item-kiem-go')!.price);

    const outcome = await shop.sell(characterId, 'item-kiem-go', 1);

    expect(expected).toBe(40);
    expect(outcome).toMatchObject({ ok: true, yen: 240, yenDelta: expected });
    expect(await readYen(characterId)).toBe(240);
    // Bán món cuối cùng thì hàng biến mất khỏi túi.
    expect(await readItemRow(characterId, 'item-kiem-go')).toBeUndefined();
    expect(await readTransactions(characterId)).toEqual([
      expect.objectContaining({ kind: 'sell', itemId: 'item-kiem-go', yenDelta: expected }),
    ]);
  });

  it('bán một phần số lượng thì phần còn lại vẫn trong túi', async () => {
    await giveItem(characterId, 'item-banh-bao', { quantity: 3 });

    const outcome = await shop.sell(characterId, 'item-banh-bao', 2);

    expect(outcome).toMatchObject({ ok: true, yen: 224 });
    expect(await readItemRow(characterId, 'item-banh-bao')).toMatchObject({ quantity: 1 });
  });

  it('bán món đang mặc → item_equipped, không mất món', async () => {
    await giveItem(characterId, 'item-kiem-go', { slot: 'weapon' });

    const outcome = await shop.sell(characterId, 'item-kiem-go', 1);

    expect(outcome).toMatchObject({ ok: false, code: ErrorCode.ITEM_EQUIPPED });
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({
      equippedSlot: 'weapon',
    });
  });

  it('bán món không sở hữu hoặc quá số lượng đang có → item_not_owned', async () => {
    expect(await shop.sell(characterId, 'item-kiem-go', 1)).toMatchObject({
      ok: false,
      code: ErrorCode.ITEM_NOT_OWNED,
    });

    await giveItem(characterId, 'item-banh-bao', { quantity: 1 });
    const outcome = await shop.sell(characterId, 'item-banh-bao', 2);

    expect(outcome).toMatchObject({ ok: false, code: ErrorCode.ITEM_NOT_OWNED });
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-banh-bao')).toMatchObject({ quantity: 1 });
  });
});

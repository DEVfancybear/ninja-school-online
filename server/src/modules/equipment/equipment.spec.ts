import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EQUIP_SLOTS, ErrorCode, type EquipmentUpdate } from '@ninja/shared';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import { fillBag, giveItem, makeCharacter, readItemRow } from '../../test/character-fixture.js';
import { DEFAULT_GAME_DATA_DIR, loadGameData, type GameData } from '../../world/game-data.js';
import { inventoryItems } from '../../db/schema.js';
import { CharacterService } from '../character/service.js';
import { resolvedFor } from '../character/stats.js';
import { InventoryService } from '../inventory/service.js';
import { EquipmentService } from './service.js';

let gameData: GameData;
let inventory: InventoryService;
let characters: CharacterService;
let equipment: EquipmentService;
let characterId: string;

async function newServices(): Promise<void> {
  const db = await getTestDb();
  gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  inventory = new InventoryService(db, gameData);
  characters = new CharacterService(db, inventory, gameData);
  equipment = new EquipmentService(gameData, characters, inventory);
}

/** Chỉ số nhân vật sau khi cộng đồ đang mặc — đúng cách HUD và ảnh chụp lúc vào trận tính. */
async function statsWithEquipment() {
  const record = await characters.findById(characterId);
  return resolvedFor(gameData, record!, await equipment.bonusFor(characterId));
}

beforeEach(async () => {
  await resetDatabase();
  await newServices();
  characterId = await makeCharacter({ yen: 1000 });
});

afterAll(async () => {
  await closeTestDb();
});

describe('EquipmentService.equip', () => {
  it('mặc món trong túi: món rời túi, ô có món, vẫn đúng một hàng', async () => {
    await giveItem(characterId, 'item-kiem-go');

    expect(await equipment.equip(characterId, 'item-kiem-go')).toEqual({ ok: true });

    // Món rời túi (túi là các hàng `equipped_slot is null`) chứ không sinh hàng thứ hai.
    expect(await inventory.list(characterId)).toEqual([]);
    expect(await inventory.countKinds(characterId)).toBe(0);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({
      quantity: 1,
      equippedSlot: 'weapon',
    });
    expect(await inventory.findRow(characterId, 'item-kiem-go')).toMatchObject({
      equippedSlot: 'weapon',
      upgradeLevel: 0,
    });
  });

  it('gói trang bị luôn đủ bốn ô theo thứ tự, ô trống có item null', async () => {
    await giveItem(characterId, 'item-kiem-go');
    await equipment.equip(characterId, 'item-kiem-go');

    const packet: EquipmentUpdate = await equipment.toPacket(characterId);
    expect(packet.slots.map((slot) => slot.slot)).toEqual([...EQUIP_SLOTS]);
    expect(packet.slots[0]).toMatchObject({
      slot: 'weapon',
      item: {
        itemId: 'item-kiem-go',
        name: 'Kiếm Gỗ',
        slot: 'weapon',
        upgradeLevel: 0,
        stats: { strength: 2, agility: 0, spirit: 0, hp: 0, mp: 0 },
        levelRequired: 1,
        price: 100,
        sellPrice: 40,
        upgradeMaxLevel: 5,
      },
    });
    expect(packet.slots.slice(1).map((slot) => slot.item)).toEqual([null, null, null]);
  });

  it('chỉ số cộng dồn của đồ đang mặc vào thẳng chỉ số dẫn xuất', async () => {
    expect(await statsWithEquipment()).toMatchObject({
      strength: 6,
      agility: 5,
      attack: 13,
      defense: 2,
      speed: 6,
      maxHp: 60,
    });

    await giveItem(characterId, 'item-kiem-go');
    await giveItem(characterId, 'item-ao-vai');
    await equipment.equip(characterId, 'item-kiem-go');
    await equipment.equip(characterId, 'item-ao-vai');

    expect(await equipment.bonusFor(characterId)).toEqual({
      strength: 2,
      agility: 1,
      spirit: 0,
      hp: 20,
      mp: 0,
    });
    // Sức mạnh cộng vào tấn công, nhanh nhẹn cộng vào phòng thủ/tốc độ, máu cộng vào máu tối đa.
    expect(await statsWithEquipment()).toMatchObject({
      strength: 8,
      agility: 6,
      attack: 17,
      defense: 3,
      speed: 7,
      maxHp: 80,
    });
  });

  it('mặc món mới vào ô đang có món: món cũ tự về túi, không mất món nào', async () => {
    characterId = await makeCharacter({ yen: 1000, level: 5 });
    await giveItem(characterId, 'item-kiem-go');
    await giveItem(characterId, 'item-kiem-sat');

    await equipment.equip(characterId, 'item-kiem-go');
    await equipment.equip(characterId, 'item-kiem-sat');

    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ equippedSlot: null });
    expect(await readItemRow(characterId, 'item-kiem-sat')).toMatchObject({
      equippedSlot: 'weapon',
    });
    // Món cũ về túi nên vẫn còn nguyên trong túi, và ô chỉ có một món.
    expect((await inventory.list(characterId)).map((row) => row.itemId)).toEqual(['item-kiem-go']);
    const packet = await equipment.toPacket(characterId);
    expect(packet.slots.find((slot) => slot.slot === 'weapon')?.item?.itemId).toBe('item-kiem-sat');
  });

  it('mặc khi túi đầy vẫn được: món trang bị rời túi chứ không thêm ô', async () => {
    await fillBag(characterId, 39);
    await giveItem(characterId, 'item-kiem-go');
    expect(await inventory.countKinds(characterId)).toBe(40);

    expect(await equipment.equip(characterId, 'item-kiem-go')).toEqual({ ok: true });
    expect(await inventory.countKinds(characterId)).toBe(39);

    // Tháo ra là hoán đổi một loại: túi trở lại đúng 40 loại như trước, không bao giờ tràn.
    expect(await equipment.unequip(characterId, 'weapon')).toEqual({ ok: true });
    expect(await inventory.countKinds(characterId)).toBe(40);
  });

  it('từ chối món không sở hữu, vật phẩm không mặc được và món quá cấp', async () => {
    await giveItem(characterId, 'item-banh-bao');
    await giveItem(characterId, 'item-kiem-sat');

    expect(await equipment.equip(characterId, 'item-ao-vai')).toEqual({
      ok: false,
      code: ErrorCode.ITEM_NOT_OWNED,
      message: 'bạn không có món này',
    });
    expect(await equipment.equip(characterId, 'item-banh-bao')).toMatchObject({
      ok: false,
      code: ErrorCode.NOT_EQUIPPABLE,
    });
    expect(await equipment.equip(characterId, 'item-kiem-sat')).toMatchObject({
      ok: false,
      code: ErrorCode.LEVEL_TOO_LOW,
    });
    // Không thao tác nào ở trên được phép đổi trạng thái.
    expect(await equipment.toPacket(characterId)).toEqual({
      slots: EQUIP_SLOTS.map((slot) => ({ slot, item: null })),
    });
  });
});

describe('EquipmentService.unequip', () => {
  it('tháo món về túi và chỉ số trở lại như trước khi mặc', async () => {
    const before = await statsWithEquipment();
    await giveItem(characterId, 'item-kiem-go');
    await equipment.equip(characterId, 'item-kiem-go');
    const worn = await statsWithEquipment();

    expect(await equipment.unequip(characterId, 'weapon')).toEqual({ ok: true });

    expect((await inventory.list(characterId)).map((row) => row.itemId)).toEqual(['item-kiem-go']);
    expect(await statsWithEquipment()).toEqual(before);
    expect(worn.attack).toBeGreaterThan(before.attack);
  });

  it('tháo ô trống bị từ chối', async () => {
    expect(await equipment.unequip(characterId, 'head')).toMatchObject({
      ok: false,
      code: ErrorCode.ITEM_NOT_OWNED,
    });
  });
});

describe('ràng buộc mỗi ô một món', () => {
  it('database từ chối hai hàng cùng một ô', async () => {
    const db = await getTestDb();
    await giveItem(characterId, 'item-kiem-go', { slot: 'weapon' });

    await expect(
      db
        .insert(inventoryItems)
        .values({ characterId, itemId: 'item-kiem-sat', equippedSlot: 'weapon' }),
    ).rejects.toThrow();
  });

  it('database cho phép nhiều hàng cùng nằm trong túi', async () => {
    const db = await getTestDb();
    await db.insert(inventoryItems).values({ characterId, itemId: 'item-kiem-go' });
    await db.insert(inventoryItems).values({ characterId, itemId: 'item-ao-vai' });

    expect((await inventory.list(characterId)).map((row) => row.itemId)).toEqual([
      'item-kiem-go',
      'item-ao-vai',
    ]);
  });
});

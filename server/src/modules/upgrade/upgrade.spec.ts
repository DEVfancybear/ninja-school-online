import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  UPGRADE_MATERIAL_ID,
  UPGRADE_MATERIAL_QTY,
  upgradeSuccessRate,
  upgradeYenCost,
  type UpgradeResult,
} from '@ninja/shared';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import {
  giveItem,
  makeCharacter,
  readItemRow,
  readTransactions,
  readYen,
} from '../../test/character-fixture.js';
import { DEFAULT_GAME_DATA_DIR, loadGameData, type GameData } from '../../world/game-data.js';
import { CharacterService } from '../character/service.js';
import { EquipmentService } from '../equipment/service.js';
import { InventoryService } from '../inventory/service.js';
import { UpgradeService, type UpgradeOutcome } from './service.js';

/** Gieo luôn thành công / luôn thất bại, và cho biết nó có được gọi hay không. */
const alwaysSucceed = () => vi.fn(() => 0);
const alwaysFail = () => vi.fn(() => 0.999);

/** Kết quả của một lần thử **phải** thành công, để test đọc thẳng `result`. */
function expectSuccess(outcome: UpgradeOutcome): UpgradeResult {
  if (!outcome.ok) {
    throw new Error(`mong đợi cường hóa thành công nhưng bị từ chối: ${outcome.code}`);
  }
  return outcome.result;
}

/** Kết quả của một lần thử **phải** bị từ chối, để test đọc thẳng `code` và câu tiếng Việt. */
function expectReject(outcome: UpgradeOutcome): { code: ErrorCode; message: string } {
  if (outcome.ok) {
    throw new Error('mong đợi bị từ chối nhưng lần thử lại thành công');
  }
  return outcome;
}

let gameData: GameData;
let inventory: InventoryService;
let characters: CharacterService;
let equipment: EquipmentService;
let upgrade: UpgradeService;
let characterId: string;

beforeEach(async () => {
  await resetDatabase();
  const db = await getTestDb();
  gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  inventory = new InventoryService(db, gameData);
  characters = new CharacterService(db, inventory, gameData);
  equipment = new EquipmentService(gameData, characters, inventory);
  upgrade = new UpgradeService(db, gameData, characters, inventory);
  // 200 yên và 1 đá: đủ cho một lần thử ở cấp 0 (50 yên) và một lần ở cấp 1 (120 yên).
  characterId = await makeCharacter({ yen: 200 });
  await giveItem(characterId, UPGRADE_MATERIAL_ID, { quantity: 1 });
});

afterAll(async () => {
  await closeTestDb();
});

describe('UpgradeService.upgrade', () => {
  it('+0 lên +1 luôn thành công, mất đúng yên và một đá', async () => {
    await giveItem(characterId, 'item-kiem-go');
    const rng = alwaysSucceed();

    const result = expectSuccess(await upgrade.upgrade(characterId, 'item-kiem-go', rng));

    expect(result).toMatchObject({
      itemId: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      success: true,
      previousLevel: 0,
      upgradeLevel: 1,
      successRate: upgradeSuccessRate(0),
      yenCost: upgradeYenCost(0),
      materialQty: UPGRADE_MATERIAL_QTY,
    });
    expect(result.message).toContain('thành công');
    expect(rng).toHaveBeenCalledTimes(1);
    expect(await readYen(characterId)).toBe(150);
    // Mất một đá, và món lên cấp ngay trên hàng cũ (không sinh hàng mới).
    expect(await inventory.count(characterId, UPGRADE_MATERIAL_ID)).toBe(0);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 1 });

    const log = await readTransactions(characterId);
    expect(log).toEqual([
      expect.objectContaining({
        kind: 'upgrade',
        itemId: 'item-kiem-go',
        quantity: UPGRADE_MATERIAL_QTY,
        yenDelta: -(upgradeYenCost(0) ?? 0),
      }),
    ]);
    expect(log[0]?.detail).toContain('+0 lên +1');
  });

  it('thất bại thì món giữ nguyên cấp nhưng vẫn mất yên và đá', async () => {
    await giveItem(characterId, 'item-kiem-go', { upgradeLevel: 1 });
    const rng = alwaysFail();

    const result = expectSuccess(await upgrade.upgrade(characterId, 'item-kiem-go', rng));

    expect(result).toMatchObject({
      success: false,
      previousLevel: 1,
      upgradeLevel: 1,
      yenCost: upgradeYenCost(1),
      successRate: upgradeSuccessRate(1),
    });
    expect(result.message).toContain('thất bại');
    expect(await readYen(characterId)).toBe(80);
    expect(await inventory.count(characterId, UPGRADE_MATERIAL_ID)).toBe(0);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 1 });
    expect((await readTransactions(characterId))[0]).toMatchObject({
      kind: 'upgrade',
      yenDelta: -120,
    });
  });

  it('gieo dưới tỉ lệ thì lên cấp: +1 lên +2 với tỉ lệ 90%', async () => {
    await giveItem(characterId, 'item-kiem-go', { upgradeLevel: 1 });
    const rng = vi.fn(() => 0.89);

    const result = expectSuccess(await upgrade.upgrade(characterId, 'item-kiem-go', rng));

    expect(result).toMatchObject({
      success: true,
      previousLevel: 1,
      upgradeLevel: 2,
      successRate: 0.9,
    });
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 2 });
  });

  it('cường hóa món đang mặc: chỉ số cộng thêm tăng theo cấp', async () => {
    await giveItem(characterId, 'item-kiem-go', { slot: 'weapon' });
    expect(await equipment.bonusFor(characterId)).toMatchObject({ strength: 2 });

    const result = expectSuccess(
      await upgrade.upgrade(characterId, 'item-kiem-go', alwaysSucceed()),
    );

    expect(result).toMatchObject({ success: true, upgradeLevel: 1 });
    // +1: mỗi chỉ số gốc cộng thêm 20% (làm tròn lên) — sức mạnh 2 thành 3.
    expect(await equipment.bonusFor(characterId)).toMatchObject({ strength: 3 });
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({
      equippedSlot: 'weapon',
      upgradeLevel: 1,
    });
  });

  it('thiếu nguyên liệu → not_enough_material và hoàn lại yên', async () => {
    await inventory.take(characterId, UPGRADE_MATERIAL_ID, 1);
    await giveItem(characterId, 'item-kiem-go');
    const rng = alwaysSucceed();

    const rejected = expectReject(await upgrade.upgrade(characterId, 'item-kiem-go', rng));

    expect(rejected).toMatchObject({ code: ErrorCode.NOT_ENOUGH_MATERIAL });
    expect(rejected.message).toContain('Đá Vụn');
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 0 });
    expect(await readTransactions(characterId)).toEqual([]);
    // Chưa đủ nguyên liệu thì chưa tính là một lần thử: không gieo tỉ lệ.
    expect(rng).not.toHaveBeenCalled();
  });

  it('không đủ yên → not_enough_yen và giữ nguyên đá', async () => {
    characterId = await makeCharacter({ yen: 10 });
    await giveItem(characterId, UPGRADE_MATERIAL_ID, { quantity: 1 });
    await giveItem(characterId, 'item-kiem-go');
    const rng = alwaysSucceed();

    const outcome = await upgrade.upgrade(characterId, 'item-kiem-go', rng);

    expect(outcome).toMatchObject({ ok: false, code: ErrorCode.NOT_ENOUGH_YEN });
    expect(await readYen(characterId)).toBe(10);
    expect(await inventory.count(characterId, UPGRADE_MATERIAL_ID)).toBe(1);
    expect(rng).not.toHaveBeenCalled();
  });

  it('món đã đạt cấp cao nhất → upgrade_maxed, không mất gì', async () => {
    await giveItem(characterId, 'item-kiem-go', { upgradeLevel: 5 });
    const rng = alwaysSucceed();

    const rejected = expectReject(await upgrade.upgrade(characterId, 'item-kiem-go', rng));

    expect(rejected).toMatchObject({ code: ErrorCode.UPGRADE_MAXED });
    expect(rejected.message).toContain('+5');
    expect(await readYen(characterId)).toBe(200);
    expect(await inventory.count(characterId, UPGRADE_MATERIAL_ID)).toBe(1);
    expect(rng).not.toHaveBeenCalled();
  });

  it('vật phẩm không phải trang bị hoặc món không sở hữu đều bị từ chối', async () => {
    await giveItem(characterId, 'item-banh-bao');
    const rng = alwaysSucceed();

    expect(await upgrade.upgrade(characterId, 'item-banh-bao', rng)).toMatchObject({
      ok: false,
      code: ErrorCode.NOT_UPGRADABLE,
    });
    expect(await upgrade.upgrade(characterId, 'item-kiem-go', rng)).toMatchObject({
      ok: false,
      code: ErrorCode.ITEM_NOT_OWNED,
    });
    expect(await readYen(characterId)).toBe(200);
    expect(rng).not.toHaveBeenCalled();
  });

  it('cấp càng cao càng tốn yên', async () => {
    await giveItem(characterId, 'item-kiem-go', { upgradeLevel: 2 });
    await characters.addYen(characterId, 1000);

    const result = expectSuccess(
      await upgrade.upgrade(characterId, 'item-kiem-go', alwaysSucceed()),
    );

    expect(result).toMatchObject({
      success: true,
      upgradeLevel: 3,
      yenCost: upgradeYenCost(2),
      successRate: upgradeSuccessRate(2),
    });
    expect(await readYen(characterId)).toBe(1200 - (upgradeYenCost(2) ?? 0));
  });
});

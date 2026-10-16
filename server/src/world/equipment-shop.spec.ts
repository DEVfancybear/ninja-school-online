import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  Opcode,
  UPGRADE_MATERIAL_ID,
  sellPrice,
  type BattleEnd,
  type BattleStart,
  type BattleTurn,
  type CharacterStats,
  type EquipmentUpdate,
  type InventoryUpdate,
  type NpcDialog,
  type Notify,
  type UpgradeResult,
} from '@ninja/shared';
import { closeTestDb, resetDatabase } from '../test/database.js';
import { giveItem, readItemRow, readTransactions, readYen } from '../test/character-fixture.js';
import { accountWithCharacter, startTestServer, type TestServer } from '../test/game-server.js';
import { TestGameClient, delay } from '../test/ws-client.js';

/** NPC bán đồ trong làng đầu tiên (`game-data/npcs/npc-thay-do.json`). */
const SHOP_NPC_ID = 'npc-thay-do';
/** Cổng sang bãi luyện tập nằm ở ô (36, 16) của làng. */
const TRAINING_PORTAL = { x: 1152, y: 528 };
const TRAINING_MAP_ID = 'bai-luyen-tap';
/** Ô (14, 12) → tâm ô (464, 400); cách điểm spawn 264 px nên một lệnh di chuyển là tới. */
const SCARECROW_TARGET = { x: 464, y: 400 };
const SCARECROW_ID = `mob:${TRAINING_MAP_ID}:0`;

const clients: TestGameClient[] = [];
let server: TestServer;

async function connect(): Promise<TestGameClient> {
  const client = await TestGameClient.connect(server.wsUrl);
  clients.push(client);
  return client;
}

/**
 * Một nhân vật đã vào làng và đã nhận xong ba gói của bắt tay: chỉ số, túi đồ, trang bị. Ba gói này
 * là điểm khởi đầu của HUD, nên test nào cũng phải thấy chúng trước khi làm gì khác.
 */
async function enterWorld(
  username: string,
  characterName: string,
): Promise<{
  client: TestGameClient;
  characterId: string;
  stats: CharacterStats;
  inventory: InventoryUpdate;
  equipment: EquipmentUpdate;
}> {
  const { access, characterId } = await accountWithCharacter(server.app, username, characterName);
  const client = await connect();
  await client.hello({ access, characterId });

  const stats = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
  const inventory = await client.waitFor<InventoryUpdate>(Opcode.S2C_INVENTORY_UPDATE);
  const equipment = await client.waitFor<EquipmentUpdate>(Opcode.S2C_EQUIPMENT);
  return { client, characterId, stats, inventory, equipment };
}

/** Bấm vào NPC bán hàng rồi chờ hội thoại kèm bảng hàng. */
async function openShop(client: TestGameClient): Promise<NpcDialog> {
  client.send(Opcode.C2S_NPC_TALK, { npcId: SHOP_NPC_ID });
  return client.waitFor<NpcDialog>(Opcode.S2C_NPC_DIALOG);
}

/** Mua một món và chờ gói túi đồ đã cập nhật. */
async function buy(client: TestGameClient, itemId: string, quantity = 1): Promise<InventoryUpdate> {
  client.send(Opcode.C2S_SHOP_BUY, { itemId, quantity });
  return client.waitFor<InventoryUpdate>(Opcode.S2C_INVENTORY_UPDATE);
}

/**
 * Mua và dọn hết ba gói của giao dịch (túi, chỉ số, thông báo) — dùng cho test chỉ cần trạng thái
 * **sau** khi mua, tránh việc gói chỉ số còn sót lại bị nhầm với gói chỉ số của thao tác sau.
 */
async function buyAndSettle(client: TestGameClient, itemId: string, quantity = 1): Promise<void> {
  await buy(client, itemId, quantity);
  await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
  await client.waitFor<Notify>(Opcode.S2C_NOTIFY);
}

function itemIn(packet: InventoryUpdate, itemId: string) {
  return packet.items.find((item) => item.itemId === itemId);
}

function slotIn(packet: EquipmentUpdate, slot: string) {
  return packet.slots.find((entry) => entry.slot === slot);
}

/** Đánh theo lượt cho tới khi trận kết thúc, để test không để lại trận đấu treo trên server. */
async function fightToTheEnd(client: TestGameClient, characterId: string): Promise<BattleEnd> {
  let cursor = 0;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const next = await client.nextPacket(
      [
        Opcode.S2C_BATTLE_START,
        Opcode.S2C_BATTLE_TURN,
        Opcode.S2C_BATTLE_RESULT,
        Opcode.S2C_BATTLE_END,
      ],
      cursor,
      10_000,
    );
    if (!next) {
      throw new Error('trận đấu không kết thúc trong thời gian cho phép');
    }
    cursor = next.next;
    if (next.packet.op === Opcode.S2C_BATTLE_END) {
      return next.packet.payload as BattleEnd;
    }
    if (next.packet.op === Opcode.S2C_BATTLE_RESULT) {
      continue;
    }
    const turn = next.packet.payload as BattleStart | BattleTurn;
    if (turn.actorId === characterId) {
      client.send(Opcode.C2S_BATTLE_ACTION, {
        battleId: turn.battleId,
        action: 'attack',
        targetId: SCARECROW_ID,
      });
    }
  }
  throw new Error('trận đấu không kết thúc trong thời gian cho phép');
}

beforeAll(async () => {
  server = await startTestServer();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  while (clients.length > 0) {
    await clients.pop()?.close();
  }
  await delay(40);
});

afterAll(async () => {
  await server.close();
  await closeTestDb();
});

describe('bắt tay', () => {
  it('gửi kèm gói trang bị với đủ bốn ô trống', async () => {
    const { equipment } = await enterWorld('ninja_m4_hello', 'VaoGame');

    expect(equipment.slots.map((slot) => slot.slot)).toEqual([
      'weapon',
      'body',
      'head',
      'accessory',
    ]);
    expect(equipment.slots.map((slot) => slot.item)).toEqual([null, null, null, null]);
  });
});

describe('mua, mặc và tháo trang bị', () => {
  it('mua → mặc thì chỉ số tăng, tháo thì về như cũ', async () => {
    const { client, characterId, stats, equipment } = await enterWorld('ninja_m4_wear', 'MacDo');
    expect(equipment.slots.every((slot) => slot.item === null)).toBe(true);

    const dialog = await openShop(client);
    expect(dialog.npcId).toBe(SHOP_NPC_ID);
    expect(dialog.shop?.sellRatio).toBe(0.4);
    expect(dialog.shop?.entries.map((entry) => entry.itemId)).toContain('item-kiem-go');

    const bag = await buy(client, 'item-kiem-go');
    expect(itemIn(bag, 'item-kiem-go')).toMatchObject({
      name: 'Kiếm Gỗ',
      quantity: 1,
      slot: 'weapon',
      upgradeLevel: 0,
      stats: { strength: 2, agility: 0, spirit: 0, hp: 0, mp: 0 },
      levelRequired: 1,
      price: 100,
      sellPrice: 40,
      upgradeMaxLevel: 5,
    });
    const afterBuy = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
    expect(afterBuy.yen).toBe(100);
    expect((await client.waitFor<Notify>(Opcode.S2C_NOTIFY)).message).toContain('Đã mua 1');

    client.send(Opcode.C2S_EQUIP, { itemId: 'item-kiem-go' });
    const worn = await client.waitFor<EquipmentUpdate>(Opcode.S2C_EQUIPMENT);
    expect(slotIn(worn, 'weapon')?.item).toMatchObject({
      itemId: 'item-kiem-go',
      upgradeLevel: 0,
    });
    const boosted = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
    // Kiếm Gỗ +2 sức mạnh → tấn công +4 (2 điểm mỗi sức mạnh), các chỉ số khác giữ nguyên.
    expect(boosted.attack).toBe(stats.attack + 4);
    expect(boosted).toMatchObject({
      defense: stats.defense,
      speed: stats.speed,
      maxHp: stats.maxHp,
      yen: 100,
    });
    // Món đang mặc không còn nằm trong túi: nó chỉ là một hàng có `equipped_slot`.
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({
      equippedSlot: 'weapon',
      quantity: 1,
    });

    client.send(Opcode.C2S_UNEQUIP, { slot: 'weapon' });
    const off = await client.waitFor<EquipmentUpdate>(Opcode.S2C_EQUIPMENT);
    expect(slotIn(off, 'weapon')?.item).toBeNull();
    const restored = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
    expect(restored).toMatchObject({
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      maxHp: stats.maxHp,
    });
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ equippedSlot: null });

    expect(await readTransactions(characterId)).toEqual([
      expect.objectContaining({ kind: 'buy', itemId: 'item-kiem-go', yenDelta: -100 }),
    ]);
  });

  it('mặc món quá cấp bị từ chối', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_level', 'QuaCap');
    await giveItem(characterId, 'item-kiem-sat');

    client.send(Opcode.C2S_EQUIP, { itemId: 'item-kiem-sat' });

    const error = await client.waitForError(ErrorCode.LEVEL_TOO_LOW);
    expect(error.message).toContain('cấp 5');
    expect(await readItemRow(characterId, 'item-kiem-sat')).toMatchObject({ equippedSlot: null });
  });
});

describe('shop mua và bán bằng yên', () => {
  it('mua khi không đủ yên bị từ chối, không đụng túi', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_no_yen', 'HetYen');
    await openShop(client);

    client.send(Opcode.C2S_SHOP_BUY, { itemId: 'item-giap-da', quantity: 1 });

    const error = await client.waitForError(ErrorCode.NOT_ENOUGH_YEN);
    expect(error.message).toContain('600');
    expect(await readYen(characterId)).toBe(200);
    expect(client.packets(Opcode.S2C_NOTIFY)).toHaveLength(0);
    expect(await readTransactions(characterId)).toEqual([]);
  });

  it('mua món trang bị đã sở hữu → already_owned, không mất yên', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_owned', 'DaCoDo');
    await openShop(client);
    await buyAndSettle(client, 'item-kiem-go');

    client.send(Opcode.C2S_SHOP_BUY, { itemId: 'item-kiem-go', quantity: 1 });

    const error = await client.waitForError(ErrorCode.ALREADY_OWNED);
    expect(error.message).toContain('đã có');
    expect(await readYen(characterId)).toBe(100);
    expect(await readTransactions(characterId)).toHaveLength(1);
  });

  it('mua khi chưa bấm vào NPC bán hàng → not_for_sale', async () => {
    const { client } = await enterWorld('ninja_m4_no_npc', 'ChuaMoQuay');

    client.send(Opcode.C2S_SHOP_BUY, { itemId: 'item-kiem-go', quantity: 1 });

    const error = await client.waitForError(ErrorCode.NOT_FOR_SALE);
    expect(error.message).toContain('NPC');
  });

  it('bán món trong túi: yên tăng đúng giá bán lại và có hàng nhật ký', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_sell', 'BanDo');

    client.send(Opcode.C2S_SHOP_SELL, { itemId: 'item-banh-bao', quantity: 1 });

    const bag = await client.waitFor<InventoryUpdate>(Opcode.S2C_INVENTORY_UPDATE);
    expect(itemIn(bag, 'item-banh-bao')).toMatchObject({
      quantity: 1,
      sellPrice: sellPrice(30),
    });
    const stats = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
    expect(stats.yen).toBe(212);
    expect((await client.waitFor<Notify>(Opcode.S2C_NOTIFY)).message).toContain('Đã bán 1');
    expect(await readYen(characterId)).toBe(212);
    expect(await readTransactions(characterId)).toEqual([
      expect.objectContaining({
        kind: 'sell',
        itemId: 'item-banh-bao',
        quantity: 1,
        yenDelta: 12,
      }),
    ]);
  });

  it('bán món đang mặc bị từ chối → item_equipped', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_sell_worn', 'BanDoDangMac');
    await openShop(client);
    await buyAndSettle(client, 'item-kiem-go');
    client.send(Opcode.C2S_EQUIP, { itemId: 'item-kiem-go' });
    await client.waitFor<EquipmentUpdate>(Opcode.S2C_EQUIPMENT);
    const notifications = client.packets(Opcode.S2C_NOTIFY).length;

    client.send(Opcode.C2S_SHOP_SELL, { itemId: 'item-kiem-go', quantity: 1 });

    const error = await client.waitForError(ErrorCode.ITEM_EQUIPPED);
    expect(error.message).toContain('tháo ra');
    expect(client.packets(Opcode.S2C_NOTIFY)).toHaveLength(notifications);
    expect(await readYen(characterId)).toBe(100);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({
      equippedSlot: 'weapon',
    });
  });
});

describe('cường hóa trang bị', () => {
  it('+1 luôn thành công, mất đúng yên và một đá vụn', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_upgrade', 'CuongHoa');
    await giveItem(characterId, UPGRADE_MATERIAL_ID, { quantity: 1 });
    await openShop(client);
    // 200 yên − 100 (mua kiếm) − 50 (cường hóa cấp 0) = 50 yên.
    await buyAndSettle(client, 'item-kiem-go');

    client.send(Opcode.C2S_UPGRADE, { itemId: 'item-kiem-go' });

    const result = await client.waitFor<UpgradeResult>(Opcode.S2C_UPGRADE_RESULT);
    expect(result).toMatchObject({
      itemId: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      success: true,
      previousLevel: 0,
      upgradeLevel: 1,
      successRate: 1,
      yenCost: 50,
      materialQty: 1,
    });
    expect(result.message).toContain('thành công');
    const bag = await client.waitFor<InventoryUpdate>(Opcode.S2C_INVENTORY_UPDATE);
    expect(itemIn(bag, 'item-kiem-go')).toMatchObject({
      upgradeLevel: 1,
      stats: { strength: 3 },
      quantity: 1,
    });
    await client.waitFor<EquipmentUpdate>(Opcode.S2C_EQUIPMENT);
    const stats = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
    expect(stats.yen).toBe(50);
    expect(await readYen(characterId)).toBe(50);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 1 });
    expect(await readTransactions(characterId)).toEqual([
      expect.objectContaining({ kind: 'buy', yenDelta: -100 }),
      expect.objectContaining({ kind: 'upgrade', itemId: 'item-kiem-go', yenDelta: -50 }),
    ]);
  });

  it('thiếu đá vụn bị từ chối và không mất yên', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_no_stone', 'ThieuDa');
    await openShop(client);
    await buyAndSettle(client, 'item-kiem-go');

    client.send(Opcode.C2S_UPGRADE, { itemId: 'item-kiem-go' });

    const error = await client.waitForError(ErrorCode.NOT_ENOUGH_MATERIAL);
    expect(error.message).toContain('Đá Vụn');
    expect(await readYen(characterId)).toBe(100);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 0 });
    expect(await readTransactions(characterId)).toHaveLength(1);
  });

  it('món đã +5 bị từ chối → upgrade_maxed', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_maxed', 'DaToiDa');
    await giveItem(characterId, 'item-kiem-go', { upgradeLevel: 5 });
    await giveItem(characterId, UPGRADE_MATERIAL_ID, { quantity: 1 });

    client.send(Opcode.C2S_UPGRADE, { itemId: 'item-kiem-go' });

    const error = await client.waitForError(ErrorCode.UPGRADE_MAXED);
    expect(error.message).toContain('+5');
    expect(await readYen(characterId)).toBe(200);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ upgradeLevel: 5 });
  });
});

describe('đang trong trận thì không đổi trang bị hay mua bán', () => {
  it('mặc đồ và mua hàng giữa trận đều bị từ chối bằng in_battle', async () => {
    const { client, characterId } = await enterWorld('ninja_m4_in_battle', 'TrongTran');
    await giveItem(characterId, 'item-kiem-go');

    client.send(Opcode.C2S_MOVE, TRAINING_PORTAL);
    await client.waitFor(
      Opcode.S2C_ENTER_MAP,
      (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
      10_000,
    );
    client.send(Opcode.C2S_MOVE, SCARECROW_TARGET);
    await client.waitFor(
      Opcode.S2C_ENTITY_MOVE,
      (payload) =>
        (payload as { moves: { id: string; x: number; y: number }[] }).moves.some(
          (move) =>
            move.id === characterId &&
            Math.abs(move.x - SCARECROW_TARGET.x) <= 2 &&
            Math.abs(move.y - SCARECROW_TARGET.y) <= 2,
        ),
      10_000,
    );
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START, undefined, 10_000);

    client.send(Opcode.C2S_EQUIP, { itemId: 'item-kiem-go' });
    const equipError = await client.waitForError(ErrorCode.IN_BATTLE);
    expect(equipError.message).toContain('trận đấu');

    client.send(Opcode.C2S_SHOP_BUY, { itemId: 'item-kiem-go', quantity: 1 });
    await client.waitForError(ErrorCode.IN_BATTLE);
    expect(await readItemRow(characterId, 'item-kiem-go')).toMatchObject({ equippedSlot: null });

    // Trận kết thúc thì mặc đồ lại được — luật chỉ chặn trong lúc giao tranh.
    const end = await fightToTheEnd(client, characterId);
    expect(end.outcome).toBe('victory');
    await delay(20);
    client.send(Opcode.C2S_EQUIP, { itemId: 'item-kiem-go' });
    const worn = await client.waitFor<EquipmentUpdate>(Opcode.S2C_EQUIPMENT);
    expect(slotIn(worn, 'weapon')?.item).toMatchObject({ itemId: 'item-kiem-go' });
  });
});

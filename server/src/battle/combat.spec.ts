import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BATTLE_MAX_PLAYERS,
  ErrorCode,
  Opcode,
  type ServerEnterMap,
  type BattleEnd,
  type BattleResult,
  type BattleStart,
  type BattleTurn,
  type CharacterStats,
  type InventoryUpdate,
  type LevelUp,
  type ServerError,
} from '@ninja/shared';
import { and, eq } from 'drizzle-orm';
import { characters, inventoryItems } from '../db/schema.js';
import { closeTestDb, getTestDb, resetDatabase } from '../test/database.js';
import { accountWithCharacter, startTestServer, type TestServer } from '../test/game-server.js';
import { copyGameDataDir, removeTemporaryGameDataDirs } from '../test/game-data-dir.js';
import { TestGameClient, delay } from '../test/ws-client.js';

/** Bãi luyện tập: điểm spawn mặc định và bốn con bù nhìn. */
const TRAINING_MAP_ID = 'bai-luyen-tap';
/** Ô (14, 12) → tâm ô (464, 400); cách điểm spawn 264 px nên một lệnh di chuyển là tới. */
const SCARECROW_TARGET = { x: 464, y: 400 };
const SCARECROW_ID = `mob:${TRAINING_MAP_ID}:0`;

/** Số lượng một vật phẩm trong túi, đọc thẳng từ database cho khỏi phụ thuộc gói tin. */
async function readBag(characterId: string, itemId: string): Promise<number> {
  const db = await getTestDb();
  const [row] = await db
    .select({ quantity: inventoryItems.quantity })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.itemId, itemId)))
    .limit(1);
  return row?.quantity ?? 0;
}

/** Máu/nội lực đang lưu trong database của một nhân vật. */
async function readVitals(characterId: string): Promise<{ hp: number | null; mp: number | null }> {
  const db = await getTestDb();
  const [row] = await db
    .select({ hp: characters.hp, mp: characters.mp })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return row ?? { hp: null, mp: null };
}

/** Chờ tới khi nhân vật bị đánh trúng ít nhất một lần, trả về máu trong database lúc đó. */
/** Chờ gói kết quả mà **quái** đánh trúng mình, rồi trả về máu của mình trong gói đó. */
async function waitUntilWounded(
  client: TestGameClient,
  characterId: string,
): Promise<{ hp: number; maxHp: number }> {
  const battle = await client.waitFor<BattleResult>(
    Opcode.S2C_BATTLE_RESULT,
    (payload) =>
      (payload as BattleResult).events.some(
        (event) => event.targetId === characterId && event.kind === 'damage',
      ),
    10_000,
  );
  const me = battle.participants.find((combatant) => combatant.id === characterId);
  if (!me) {
    throw new Error('không thấy nhân vật trong danh sách người tham gia');
  }
  return { hp: me.hp, maxHp: me.maxHp };
}

/** Sát thương của một đòn đánh thường, để kiểm tra máu giảm đúng bằng số đó. */
function resultDamage(result: BattleResult, targetId: string): number {
  return result.events
    .filter((event) => event.kind === 'damage' && event.targetId === targetId)
    .reduce((total, event) => total + (event.value ?? 0), 0);
}

async function connect(url: string): Promise<TestGameClient> {
  const client = await TestGameClient.connect(url);
  clients.push(client);
  return client;
}

const clients: TestGameClient[] = [];
let server: TestServer;

/** Một nhân vật đã vào bãi luyện tập và đứng sát con bù nhìn đầu tiên. */
async function enterTrainingGround(
  username: string,
  characterName: string,
): Promise<{ client: TestGameClient; characterId: string }> {
  const { access, characterId } = await accountWithCharacter(server.app, username, characterName);
  const client = await connect(server.wsUrl);
  const { hello } = await client.hello({ access, characterId });

  // Đi bộ sang bãi luyện tập qua cổng ở làng, đúng đường người chơi đi.
  client.send(Opcode.C2S_MOVE, { x: 1152, y: 528 });
  const toPortal = await client.waitFor<{ map: { id: string } }>(
    Opcode.S2C_ENTER_MAP,
    (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
    10000,
  );
  expect(toPortal.map.id).toBe(TRAINING_MAP_ID);
  expect(hello.mapId).toBe('lang-khoi-nguon');

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
    10000,
  );
  return { client, characterId };
}

/** Nhân vật trong bãi luyện tập (đã vào game, chưa đi tới con bù nhìn nào). */
async function enterTrainingMapOnly(
  username: string,
  characterName: string,
): Promise<{ client: TestGameClient; characterId: string; enterMap: ServerEnterMap }> {
  const { access, characterId } = await accountWithCharacter(server.app, username, characterName);
  const client = await connect(server.wsUrl);
  await client.hello({ access, characterId });
  client.send(Opcode.C2S_MOVE, { x: 1152, y: 528 });
  const enterMap = await client.waitFor<ServerEnterMap>(
    Opcode.S2C_ENTER_MAP,
    (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
    10000,
  );
  return { client, characterId, enterMap };
}

/**
 * Đánh theo lượt cho tới khi trận kết thúc: mỗi lần server báo tới lượt mình thì gửi một đòn đánh
 * thường. Trả về gói `S2C_BATTLE_END` của client này và mọi gói `S2C_BATTLE_RESULT` đã thấy.
 */
async function fightToTheEnd(
  client: TestGameClient,
  characterId: string,
): Promise<{ end: BattleEnd; results: BattleResult[] }> {
  const results: BattleResult[] = [];
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
      return { end: next.packet.payload as BattleEnd, results };
    }
    if (next.packet.op === Opcode.S2C_BATTLE_RESULT) {
      results.push(next.packet.payload as BattleResult);
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
  await removeTemporaryGameDataDirs();
  await closeTestDb();
});

describe('vào trận và đánh quái', () => {
  it('bắt tay xong là có ngay chỉ số nhân vật và túi đồ', async () => {
    const { access, characterId } = await accountWithCharacter(
      server.app,
      'ninja_m3_who',
      'XemChiSo',
    );
    const client = await connect(server.wsUrl);
    await client.hello({ access, characterId });

    const stats = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
    expect(stats).toMatchObject({
      id: characterId,
      name: 'XemChiSo',
      school: 'haruna',
      class: 'dao',
      level: 1,
      exp: 0,
      yen: 200,
    });
    expect(stats.maxHp).toBe(60);
    expect(stats.hp).toBe(60);
    expect(stats.maxMp).toBe(40);
    expect(stats.expToNext).toBe(30);
    expect(stats.skills.map((skill) => skill.skillId)).toEqual(['skill-tram-co-ban']);

    const bag = await client.waitFor<InventoryUpdate>(Opcode.S2C_INVENTORY_UPDATE);
    expect(bag.capacity).toBeGreaterThan(0);
    expect(bag.items).toContainEqual(
      expect.objectContaining({ itemId: 'item-banh-bao', quantity: 2, usable: true }),
    );
  });

  it('quái trên bản đồ được gửi kèm máu và hình dáng', async () => {
    const { enterMap } = await enterTrainingMapOnly('ninja_m3_see', 'ThayQuai');

    const monsters = enterMap.entities.filter((entity) => entity.kind === 'monster');
    expect(monsters).toHaveLength(4);
    expect(monsters[0]).toMatchObject({
      id: SCARECROW_ID,
      name: 'Bù Nhìn Tập Luyện',
      kind: 'monster',
      hp: 30,
      maxHp: 30,
      shape: 'scarecrow',
      level: 1,
    });
    expect(monsters[0]?.x).toBe(SCARECROW_TARGET.x);
    expect(monsters[0]?.y).toBe(SCARECROW_TARGET.y);
  });

  it('chạm quái khi đứng xa → out_of_range và không mở trận', async () => {
    // Vào bãi luyện tập nhưng đứng ở điểm spawn, cách con bù nhìn 264 px (> 96 px).
    const { access, characterId } = await accountWithCharacter(
      server.app,
      'ninja_m3_far',
      'DungXa',
    );
    const client = await connect(server.wsUrl);
    await client.hello({ access, characterId });
    client.send(Opcode.C2S_MOVE, { x: 1152, y: 528 });
    await client.waitFor(
      Opcode.S2C_ENTER_MAP,
      (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
      10000,
    );

    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const error = await client.waitForError(ErrorCode.OUT_OF_RANGE);
    expect(error.message).toContain('quá xa');
    expect(client.packets(Opcode.S2C_BATTLE_START)).toHaveLength(0);
  });

  it('chạm quái không tồn tại → monster_gone', async () => {
    const { client } = await enterTrainingGround('ninja_m3_gone', 'QuaiBienMat');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: 'mob:khong-co:99' });
    const error = await client.waitForError(ErrorCode.MONSTER_GONE);
    expect(error.message).toContain('không có con quái này');
  });

  it('trận mở đúng hai bên, tới lượt người nhanh hơn, và đánh hạ được quái', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_fight', 'DanhQuai');
    const mark = client.mark();
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });

    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    expect(start.participants).toHaveLength(2);
    expect(start.participants.filter((combatant) => combatant.kind === 'monster')).toHaveLength(1);
    // Người chơi cấp 1 nhanh hơn bù nhìn (tốc độ 6 so với 3) nên được đi trước.
    expect(start.actorId).toBe(characterId);
    expect(start.turnMs).toBeGreaterThan(0);
    expect(start.turnEndsAt).toBeGreaterThan(Date.now());
    const me = start.participants.find((combatant) => combatant.id === characterId);
    expect(me?.skills?.map((skill) => skill.skillId)).toEqual(['skill-tram-co-ban']);

    const { end, results } = await fightToTheEnd(client, characterId);
    expect(end.outcome).toBe('victory');
    expect(end.monsterName).toBe('Bù Nhìn Tập Luyện');
    expect(end.rewards?.exp).toBeGreaterThan(0);
    expect(end.rewards?.yen).toBeGreaterThan(0);
    expect(end.rewards?.drops).toContainEqual(
      expect.objectContaining({ itemId: 'item-banh-bao', qty: 1 }),
    );

    // Máu của quái giảm đúng bằng tổng sát thương server báo, và có lượt của cả hai bên.
    const dealt = results.reduce((total, result) => total + resultDamage(result, SCARECROW_ID), 0);
    expect(dealt).toBeGreaterThanOrEqual(30);
    expect(end.participants.find((c) => c.kind === 'monster')).toMatchObject({
      hp: 0,
      alive: false,
    });
    expect(results.some((result) => result.actorId === SCARECROW_ID)).toBe(true);

    // Trên bản đồ, con quái cũng về 0 máu để mọi người thấy nó đã chết.
    const deadOnMap = client
      .since(mark, Opcode.S2C_ENTITY_ADD)
      .map((packet) => (packet.payload as { entity: { id: string; hp: number } }).entity)
      .filter((entity) => entity.id === SCARECROW_ID);
    expect(deadOnMap.at(-1)?.hp).toBe(0);
  });

  it('quái đã chết thì chờ sống lại mới đánh được tiếp', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_respawn', 'ChoSongLai');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    await fightToTheEnd(client, characterId);

    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const error = await client.waitForError(ErrorCode.MONSTER_GONE);
    expect(error.message).toContain('sống lại');
  });
});

describe('luật trong trận', () => {
  it('không di chuyển được khi đang trong trận', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_move', 'DungYen');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);

    client.send(Opcode.C2S_MOVE, { x: start.participants.length > 0 ? 300 : 300, y: 400 });
    const error = await client.waitForError(ErrorCode.IN_BATTLE);
    expect(error.message).toContain('trận đấu');

    // Vào trận thứ hai khi đang đánh nhau cũng bị từ chối.
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: `mob:${TRAINING_MAP_ID}:1` });
    const second = await client.waitForError(ErrorCode.IN_BATTLE);
    expect(second.message).toContain('đang trong một trận');
    expect(characterId).toBe(start.participants.find((c) => c.kind === 'player')?.id);
  });

  it('đánh sai lượt → not_your_turn; lượt của quái thì client không hành động được', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_turn', 'SaiLuot');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);

    // Gửi hai lệnh trong cùng một lượt: lệnh thứ hai chắc chắn không còn là lượt của mình.
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'attack',
      targetId: SCARECROW_ID,
    });
    await client.waitFor<BattleResult>(Opcode.S2C_BATTLE_RESULT);
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'attack',
      targetId: SCARECROW_ID,
    });

    const error = await client.waitForError(ErrorCode.NOT_YOUR_TURN, 8000).catch(async () => {
      // Nếu quái vừa được tới lượt thì lệnh bị từ chối vì đang là lượt của quái — cùng ý nghĩa.
      return (await client.waitForError()) as ServerError;
    });
    expect([ErrorCode.NOT_YOUR_TURN]).toContain(error.code);
    expect(characterId).toBeTruthy();
  });

  it('dùng chiêu chưa học → skill_not_known', async () => {
    const { client } = await enterTrainingGround('ninja_m3_skill', 'DungChieu');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);

    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'skill',
      skillId: 'skill-khong-co',
      targetId: SCARECROW_ID,
    });
    expect((await client.waitForError(ErrorCode.SKILL_NOT_KNOWN)).message).toContain('chưa học');

    // Chiêu cấp 3 thì nhân vật cấp 1 chưa học, dù chiêu có thật trong game-data.
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'skill',
      skillId: 'skill-tram-cuong-phong',
      targetId: SCARECROW_ID,
    });
    expect((await client.waitForError(ErrorCode.SKILL_NOT_KNOWN)).message).toContain('chưa học');
  });

  it('chiêu đang hồi chiêu → skill_cooldown; hết nội lực → not_enough_mp', async () => {
    // Dữ liệu thử: quái dai và hiền (đủ lượt để thử luật), chiêu cơ bản thành chiêu hồi 2 vòng, tốn 25 nội lực.
    const gameDataDir = await copyGameDataDir((files) => {
      const monster = files.monsters['monsters/mob-bui-nhon.json'] as Record<string, number>;
      monster.maxHp = 300;
      monster.attack = 1;
      monster.defense = 0;
      monster.speed = 1;
      const skill = files.skills['skills/skill-tram-co-ban.json'] as Record<string, number>;
      skill.cooldownMs = 60_000;
      skill.costMp = 25;
    });
    const lawServer = await startTestServer({ gameDataDir });
    try {
      const { access, characterId } = await accountWithCharacter(
        lawServer.app,
        'ninja_m3_cd',
        'HoiChieu',
      );
      const client = await TestGameClient.connect(lawServer.wsUrl);
      clients.push(client);
      await client.hello({ access, characterId });
      client.send(Opcode.C2S_MOVE, { x: 1152, y: 528 });
      await client.waitFor(
        Opcode.S2C_ENTER_MAP,
        (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
        10000,
      );
      client.send(Opcode.C2S_MOVE, SCARECROW_TARGET);
      await client.waitFor(
        Opcode.S2C_ENTITY_MOVE,
        (payload) =>
          (payload as { moves: { id: string; x: number }[] }).moves.some(
            (move) => move.id === characterId && Math.abs(move.x - SCARECROW_TARGET.x) <= 2,
          ),
        10000,
      );

      client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
      const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
      // Con trỏ bắt đầu từ gói mới nhất: các gói trước đó (bắt tay, vào bản đồ, mở trận) đã xử lý xong.
      let cursor = client.packets().length;
      const waitMyTurn = async (): Promise<void> => {
        for (;;) {
          const next = await client.nextPacket([Opcode.S2C_BATTLE_TURN], cursor, 10_000);
          if (!next) {
            throw new Error('không tới lượt người chơi nữa');
          }
          cursor = next.next;
          if ((next.packet.payload as BattleTurn).actorId === characterId) {
            return;
          }
        }
      };

      // Vòng 1: dùng chiêu (mất 25 nội lực, còn 15) — quái dai nên không chết.
      client.send(Opcode.C2S_BATTLE_ACTION, {
        battleId: start.battleId,
        action: 'skill',
        skillId: 'skill-tram-co-ban',
        targetId: SCARECROW_ID,
      });
      const cast = await client.waitFor<BattleResult>(
        Opcode.S2C_BATTLE_RESULT,
        (payload) => (payload as BattleResult).action === 'skill',
      );
      expect(resultDamage(cast, SCARECROW_ID)).toBeGreaterThan(0);
      expect(cast.participants.find((c) => c.id === characterId)?.mp).toBe(15);

      // Vòng 2: chiêu còn hồi 1 vòng, rồi đánh thường cho hết lượt.
      await waitMyTurn();
      client.send(Opcode.C2S_BATTLE_ACTION, {
        battleId: start.battleId,
        action: 'skill',
        skillId: 'skill-tram-co-ban',
        targetId: SCARECROW_ID,
      });
      const cooldown = await client.waitForError(ErrorCode.SKILL_COOLDOWN);
      expect(cooldown.message).toContain('hồi');

      client.send(Opcode.C2S_BATTLE_ACTION, {
        battleId: start.battleId,
        action: 'attack',
        targetId: SCARECROW_ID,
      });
      await client.waitFor<BattleResult>(
        Opcode.S2C_BATTLE_RESULT,
        (payload) => (payload as BattleResult).action === 'attack',
      );

      // Vòng 3: chiêu đã sẵn sàng nhưng chỉ còn 15 nội lực.
      await waitMyTurn();
      client.send(Opcode.C2S_BATTLE_ACTION, {
        battleId: start.battleId,
        action: 'skill',
        skillId: 'skill-tram-co-ban',
        targetId: SCARECROW_ID,
      });
      expect((await client.waitForError(ErrorCode.NOT_ENOUGH_MP)).message).toContain('nội lực');
    } finally {
      await lawServer.close();
    }
  });

  it('dùng vật phẩm trong trận khi đã đầy máu → item_no_effect, không mất món', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_fullfight', 'DayMauTran');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);

    // Bù nhìn chưa kịp đánh (người chơi đi trước) nên máu vẫn đầy: dùng bánh bao lúc này là phí.
    expect(await readBag(characterId, 'item-banh-bao')).toBe(2);
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'item',
      itemId: 'item-banh-bao',
      targetId: SCARECROW_ID,
    });
    const error = await client.waitForError(ErrorCode.ITEM_NO_EFFECT);
    expect(error.message).toContain('đầy');

    // Lượt chưa bị tiêu vì lệnh bị từ chối: đánh thường vẫn được.
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'attack',
      targetId: SCARECROW_ID,
    });
    await client.waitFor<BattleResult>(
      Opcode.S2C_BATTLE_RESULT,
      (payload) => (payload as BattleResult).action === 'attack',
    );
    expect(await readBag(characterId, 'item-banh-bao')).toBe(2);
  });

  it('mất kết nối giữa trận thì máu đang có được ghi lại (không hồi đầy miễn phí)', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_drop', 'NgatKetNoi');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);

    // Đánh một đòn để tới lượt bù nhìn, rồi chờ nó đánh trả (máu giảm) và ngắt kết nối giữa trận.
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'attack',
      targetId: SCARECROW_ID,
    });
    await client.waitFor<BattleResult>(
      Opcode.S2C_BATTLE_RESULT,
      (payload) => (payload as BattleResult).actorId === characterId,
    );
    const wounded = await waitUntilWounded(client, characterId);
    await client.close();
    clients.splice(clients.indexOf(client), 1);

    await expect
      .poll(async () => (await readVitals(characterId)).hp, {
        message: 'chờ máu trong database khớp với máu lúc ngắt kết nối',
        timeout: 5000,
      })
      .toBe(wounded.hp);
    expect((await readVitals(characterId)).hp).toBeLessThan(wounded.maxHp);
  });

  it('trong trận mà dùng túi đồ trực tiếp → in_battle (phải dùng qua lượt)', async () => {
    const { client } = await enterTrainingGround('ninja_m3_bag', 'DungTui');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);

    client.send(Opcode.C2S_USE_ITEM, { itemId: 'item-banh-bao' });
    const error = await client.waitForError(ErrorCode.IN_BATTLE);
    expect(error.message).toContain('một lượt');
  });
});

describe('chơi chung và phần thưởng', () => {
  it('hai người chơi cùng vào một trận đánh chung một con quái', async () => {
    const first = await enterTrainingGround('ninja_m3_p1', 'NguoiMot');
    const second = await enterTrainingGround('ninja_m3_p2', 'NguoiHai');

    first.client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const startOne = await first.client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    expect(startOne.participants).toHaveLength(2);

    second.client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const startTwo = await second.client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    expect(startTwo.battleId).toBe(startOne.battleId);
    expect(startTwo.participants.filter((combatant) => combatant.kind === 'player')).toHaveLength(
      2,
    );

    // Người thứ nhất cũng nhận được thông báo có người vào trận.
    const joined = await first.client.waitFor<BattleStart>(
      Opcode.S2C_BATTLE_START,
      (payload) =>
        (payload as BattleStart).participants.filter((c) => c.kind === 'player').length === 2,
    );
    expect(joined.battleId).toBe(startOne.battleId);

    // Người thứ ba bị từ chối vì trận đã đủ người.
    const third = await enterTrainingGround('ninja_m3_p3', 'NguoiBa');
    third.client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const full = await third.client.waitForError(ErrorCode.INVALID_TARGET);
    expect(full.message).toContain(String(BATTLE_MAX_PLAYERS));

    const [endOne, endTwo] = await Promise.all([
      fightToTheEnd(first.client, first.characterId),
      fightToTheEnd(second.client, second.characterId),
    ]);
    expect(endOne.end.outcome).toBe('victory');
    expect(endTwo.end.outcome).toBe('victory');
    // Cả hai đều nhận thưởng như nhau, và tổng sát thương của hai người đủ hạ con bù nhìn 30 máu.
    expect(endOne.end.rewards?.exp).toBe(endTwo.end.rewards?.exp);
    const total =
      endOne.results.reduce((sum, result) => sum + resultDamage(result, SCARECROW_ID), 0) +
      endTwo.results.reduce((sum, result) => sum + resultDamage(result, SCARECROW_ID), 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it('đánh hạ quái liên tiếp → lên nhiều cấp trong một trận, và dùng được vật phẩm rơi', async () => {
    // Bù nhìn thưởng nhiều kinh nghiệm để một trận là thấy rõ việc lên cấp (đủ ba cấp).
    const gameDataDir = await copyGameDataDir((files) => {
      // 300 kinh nghiệm = đúng ba cấp (cần tổng 238 để lên cấp 4), dư 62.
      const monster = files.monsters['monsters/mob-bui-nhon.json'] as { expReward: number };
      monster.expReward = 300;
    });
    const levelServer = await startTestServer({ gameDataDir });
    try {
      const { access, characterId } = await accountWithCharacter(
        levelServer.app,
        'ninja_m3_level',
        'LenCap',
      );
      const client = await TestGameClient.connect(levelServer.wsUrl);
      clients.push(client);
      await client.hello({ access, characterId });
      const before = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
      expect(before.level).toBe(1);

      client.send(Opcode.C2S_MOVE, { x: 1152, y: 528 });
      await client.waitFor(
        Opcode.S2C_ENTER_MAP,
        (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
        10000,
      );
      client.send(Opcode.C2S_MOVE, SCARECROW_TARGET);
      await client.waitFor(
        Opcode.S2C_ENTITY_MOVE,
        (payload) =>
          (payload as { moves: { id: string; x: number }[] }).moves.some(
            (move) => move.id === characterId && Math.abs(move.x - SCARECROW_TARGET.x) <= 2,
          ),
        10000,
      );

      client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
      const { end } = await fightToTheEnd(client, characterId);
      expect(end.outcome).toBe('victory');
      expect(end.rewards).toMatchObject({ exp: 300, levelsGained: 3, level: 4 });

      const levelUp = await client.waitFor<LevelUp>(Opcode.S2C_LEVEL_UP);
      expect(levelUp.levelsGained).toBe(3);
      expect(levelUp.character.level).toBe(4);
      expect(levelUp.character.maxHp).toBeGreaterThan(before.maxHp);
      expect(levelUp.character.expToNext).toBeGreaterThan(0);

      // Vật phẩm rơi vào túi, và dùng được để hồi máu (bù nhìn có đánh trúng vài lần).
      const bag = await client.waitFor<InventoryUpdate>(
        Opcode.S2C_INVENTORY_UPDATE,
        (payload) =>
          ((payload as InventoryUpdate).items.find((item) => item.itemId === 'item-banh-bao')
            ?.quantity ?? 0) > 2,
      );
      const bao = bag.items.find((item) => item.itemId === 'item-banh-bao');
      expect(bao?.quantity).toBeGreaterThan(2);

      const afterFight = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER, (payload) => {
        const stats = payload as CharacterStats;
        return stats.level === 4 && stats.hp < stats.maxHp;
      });
      client.send(Opcode.C2S_USE_ITEM, { itemId: 'item-banh-bao' });
      const healed = await client.waitFor<CharacterStats>(
        Opcode.S2C_CHARACTER,
        (payload) => (payload as CharacterStats).hp > afterFight.hp,
      );
      expect(healed.hp - afterFight.hp).toBeLessThanOrEqual(40);
      const afterUse = await client.waitFor<InventoryUpdate>(
        Opcode.S2C_INVENTORY_UPDATE,
        (payload) =>
          ((payload as InventoryUpdate).items.find((item) => item.itemId === 'item-banh-bao')
            ?.quantity ?? 0) < (bao?.quantity ?? 0),
      );
      expect(afterUse.items.find((item) => item.itemId === 'item-banh-bao')?.quantity).toBe(
        (bao?.quantity ?? 0) - 1,
      );
    } finally {
      await levelServer.close();
    }
  });

  it('dùng vật phẩm khi đang đầy máu → item_no_effect, không mất đồ', async () => {
    const { client } = await enterTrainingGround('ninja_m3_full', 'DayMau');
    client.send(Opcode.C2S_USE_ITEM, { itemId: 'item-banh-bao' });
    const error = await client.waitForError(ErrorCode.ITEM_NO_EFFECT);
    expect(error.message).toContain('đầy');

    const bag = await client.waitFor<InventoryUpdate>(Opcode.S2C_INVENTORY_UPDATE);
    expect(bag.items.find((item) => item.itemId === 'item-banh-bao')?.quantity).toBe(2);
  });

  it('nhân vật thua thì hồi sinh ở làng với nửa máu và mất một phần yên', async () => {
    // Quái trong dữ liệu thử rất mạnh: người chơi cấp 1 chỉ đánh được một đòn rồi gục.
    const gameDataDir = await copyGameDataDir((files) => {
      const monster = files.monsters['monsters/mob-bui-nhon.json'] as {
        attack: number;
        speed: number;
      };
      monster.attack = 5000;
      monster.speed = 99;
    });
    const strongServer = await startTestServer({ gameDataDir });
    try {
      const { access, characterId } = await accountWithCharacter(
        strongServer.app,
        'ninja_m3_defeat',
        'BiDanh',
      );
      const client = await TestGameClient.connect(strongServer.wsUrl);
      clients.push(client);
      await client.hello({ access, characterId });
      const before = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);

      client.send(Opcode.C2S_MOVE, { x: 1152, y: 528 });
      await client.waitFor(
        Opcode.S2C_ENTER_MAP,
        (payload) => (payload as { map: { id: string } }).map?.id === TRAINING_MAP_ID,
        10000,
      );
      client.send(Opcode.C2S_MOVE, SCARECROW_TARGET);
      await client.waitFor(
        Opcode.S2C_ENTITY_MOVE,
        (payload) =>
          (payload as { moves: { id: string; x: number }[] }).moves.some(
            (move) => move.id === characterId && Math.abs(move.x - SCARECROW_TARGET.x) <= 2,
          ),
        10000,
      );

      client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
      const { end } = await fightToTheEnd(client, characterId);
      expect(end.outcome).toBe('defeat');
      expect(end.rewards).toBeNull();

      const revived = await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER, (payload) => {
        const stats = payload as CharacterStats;
        return stats.hp < stats.maxHp;
      });
      expect(revived.hp).toBe(Math.round(before.maxHp / 2));
      expect(revived.yen).toBeLessThan(before.yen);

      // Về lại làng khởi đầu ngay sau khi thua.
      const backHome = await client.waitFor<{ map: { id: string } }>(
        Opcode.S2C_ENTER_MAP,
        (payload) => (payload as { map: { id: string } }).map?.id === 'lang-khoi-nguon',
      );
      expect(backHome.map.id).toBe('lang-khoi-nguon');
    } finally {
      await strongServer.close();
    }
  });

  it('quái còn sống được hồi đầy máu sau khi người chơi bỏ chạy', async () => {
    const { client, characterId } = await enterTrainingGround('ninja_m3_flee', 'ChayTron');
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const start = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: start.battleId,
      action: 'attack',
      targetId: SCARECROW_ID,
    });
    await client.waitFor<BattleResult>(Opcode.S2C_BATTLE_RESULT);

    // Chạy cho tới khi thoát (50% mỗi lượt, tối đa 10 lần) — server không bao giờ cho thoát chắc chắn.
    let fled = false;
    let cursor = 0;
    for (let attempt = 0; attempt < 10 && !fled; attempt += 1) {
      for (;;) {
        const next = await client.nextPacket(
          [Opcode.S2C_BATTLE_TURN, Opcode.S2C_BATTLE_END],
          cursor,
          8000,
        );
        if (!next) {
          throw new Error('không thấy lượt nào để chạy');
        }
        cursor = next.next;
        if (next.packet.op === Opcode.S2C_BATTLE_END) {
          expect((next.packet.payload as BattleEnd).outcome).toBe('fled');
          fled = true;
          break;
        }
        const turn = next.packet.payload as BattleTurn;
        if (turn.actorId === characterId) {
          client.send(Opcode.C2S_BATTLE_ACTION, { battleId: turn.battleId, action: 'flee' });
          break;
        }
      }
    }
    expect(fled).toBe(true);

    // Quái còn sống đã hồi đầy máu: chạm lại vẫn vào trận được và máu đầy 30.
    await delay(200);
    client.send(Opcode.C2S_ATTACK_MOB, { targetId: SCARECROW_ID });
    const again = await client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    expect(again.participants.find((combatant) => combatant.kind === 'monster')?.hp).toBe(30);
  });
});

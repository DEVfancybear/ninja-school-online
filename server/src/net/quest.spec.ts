import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  MAX_MOVE_DISTANCE_PX,
  MONSTER_ENGAGE_RANGE_PX,
  Opcode,
  type BattleEnd,
  type BattleTurn,
  type CharacterStats,
  type EntityMove,
  type LevelUp,
  type NpcDialog,
  type Notify,
  type QuestUpdate,
  type ServerEnterMap,
} from '@ninja/shared';
import { and, eq } from 'drizzle-orm';
import { characterQuests, characters, inventoryItems } from '../db/schema.js';
import { closeTestDb, getTestDb, resetDatabase } from '../test/database.js';
import { fillBag } from '../test/character-fixture.js';
import { copyGameDataDir, removeTemporaryGameDataDirs } from '../test/game-data-dir.js';
import { accountWithCharacter, startTestServer, type TestServer } from '../test/game-server.js';
import { TestGameClient, delay } from '../test/ws-client.js';

const VILLAGE = 'lang-khoi-nguon';
const TRAINING = 'bai-luyen-tap';
const HEADMASTER = 'npc-thay-hieu-truong';
const TEACHER = 'npc-thay-do';
const MASTER = 'npc-su-phu';
const CHAO_LANG = 'quest-chao-lang';
const DUONG_TOI_BAI_TAP = 'quest-duong-toi-bai-tap';
const BAI_HOC_DAU_TIEN = 'quest-bai-hoc-dau-tien';
const BAI_SU = 'quest-bai-su';

/** Toạ độ pixel của NPC/cổng/quái trong `game-data/maps` (ô 32 px, tâm ô = ô * 32 + 16). */
const HEADMASTER_POS = { x: 656, y: 336 };
const TEACHER_POS = { x: 592, y: 464 };
const MASTER_POS = { x: 752, y: 272 };
const TRAINING_PORTAL_POS = { x: 1152, y: 528 };
const SCARECROW_ONE = { id: 'mob:bai-luyen-tap:0', pos: { x: 464, y: 400 } };
const SCARECROW_TWO = { id: 'mob:bai-luyen-tap:1', pos: { x: 592, y: 560 } };
/** Dừng cách cổng một đoạn rồi mới bước vào: bước vào ô cổng là `S2C_ENTER_MAP`, không phải `ENTITY_MOVE`. */
const PORTAL_APPROACH = 128;
/**
 * Bán kính coi như "đã tới nơi". NPC không đòi hỏi khoảng cách khi nói chuyện, nhưng quái thì có
 * (`MONSTER_ENGAGE_RANGE_PX`), nên chỗ đánh lấy trừ hao.
 */
const NEAR_NPC = 96;
const NEAR_MONSTER = MONSTER_ENGAGE_RANGE_PX - 16;

// 11 nhiệm vụ trước `quest-bai-su`, dùng để dựng trạng thái "sắp gặp Sư Phụ" cho bài cây hội thoại.
const BEFORE_BAI_SU = [
  'quest-chao-lang',
  'quest-duong-toi-bai-tap',
  'quest-bai-hoc-dau-tien',
  'quest-nhat-da-vun',
  'quest-chuot-dong-quanh-lang',
  'quest-do-nghe-cua-thay',
  'quest-bao-boi-dau-tien',
  'quest-luyen-than-thu',
  'quest-heo-rung-hung-han',
  'quest-thu-suc-bai-tap',
  'quest-loi-thay-day',
];

let server: TestServer;
let clients: TestGameClient[] = [];
let logins = 0;

beforeAll(async () => {
  server = await startTestServer();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  clients = [];
  // Chờ server nhả phiên của các client vừa đóng trước khi xoá database (giống bài M4).
  await delay(40);
});

afterAll(async () => {
  await server.close();
  await closeTestDb();
  await removeTemporaryGameDataDirs();
});

interface World {
  readonly client: TestGameClient;
  readonly characterId: string;
  readonly access: string;
  readonly position: { x: number; y: number };
  /** Nhật ký nhiệm vụ gửi kèm bắt tay — chứng minh "thoát ra vào lại không mất tiến độ". */
  readonly handshake: QuestUpdate;
}

interface WorldOptions {
  /** Nhiệm vụ đã trả trước khi vào game. */
  readonly completed?: readonly string[];
  /** Nhiệm vụ đang làm, kèm tiến độ ghi sẵn. */
  readonly active?: readonly { questId: string; progress: number[] }[];
  readonly level?: number;
}

/**
 * Vào thế giới: tạo tài khoản + nhân vật, dựng trước trạng thái nhiệm vụ nếu cần, rồi bắt tay.
 * `access` trả về để bài "mở lại kết nối" vào lại bằng đúng nhân vật đó.
 */
async function enterWorld(options: WorldOptions = {}): Promise<World> {
  logins += 1;
  const { access, characterId } = await accountWithCharacter(
    server.app,
    `quest_user_${logins}`,
    `Ninja${logins}`,
  );

  const db = await getTestDb();
  const rows = [
    ...(options.completed ?? []).map((questId) => ({
      characterId,
      questId,
      status: 'completed' as const,
      completedAt: new Date(),
    })),
    ...(options.active ?? []).map((entry) => ({
      characterId,
      questId: entry.questId,
      status: 'active' as const,
      progress: entry.progress,
    })),
  ];
  if (rows.length > 0) {
    await db.insert(characterQuests).values(rows);
  }
  if (options.level !== undefined) {
    await db.update(characters).set({ level: options.level }).where(eq(characters.id, characterId));
  }

  const client = await TestGameClient.connect(server.wsUrl);
  clients.push(client);
  const { enterMap } = await client.hello({ access, characterId });
  const handshake = await client.waitFor<QuestUpdate>(Opcode.S2C_QUEST_UPDATE);
  return {
    client,
    characterId,
    access,
    position: { x: enterMap.entity.x, y: enterMap.entity.y },
    handshake,
  };
}

/** Vị trí của một thực thể trong các gói `S2C_ENTITY_MOVE` kể từ mốc `mark`. */
function latestEntity(
  client: TestGameClient,
  entityId: string,
  mark: number,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  let position = fallback;
  for (const packet of client.since(mark)) {
    if (packet.op !== Opcode.S2C_ENTITY_MOVE) {
      continue;
    }
    const move = (packet.payload as EntityMove).moves.find((entry) => entry.id === entityId);
    if (move) {
      position = { x: move.x, y: move.y };
    }
  }
  return position;
}

/**
 * Đi bộ tới toạ độ. Room đẩy người chơi từng nhịp tick nên một `C2S_MOVE` chỉ đặt **đích**;
 * ở đây gửi đích rồi chờ tới khi có gói báo vị trí nằm trong bán kính `within` của đích.
 */
async function walkTo(
  client: TestGameClient,
  characterId: string,
  target: { x: number; y: number },
  from: { x: number; y: number },
  within = NEAR_NPC,
): Promise<{ x: number; y: number }> {
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  if (distance <= within) {
    return from;
  }
  const scale = Math.min(1, MAX_MOVE_DISTANCE_PX / distance);
  const destination = {
    x: Math.round(from.x + (target.x - from.x) * scale),
    y: Math.round(from.y + (target.y - from.y) * scale),
  };
  const mark = client.mark();
  client.send(Opcode.C2S_MOVE, destination);

  const deadline = Date.now() + 10_000;
  let position = from;
  while (Date.now() < deadline) {
    position = latestEntity(client, characterId, mark, position);
    if (Math.hypot(target.x - position.x, target.y - position.y) <= within) {
      return position;
    }
    await delay(50);
  }
  throw new Error(
    `nhân vật dừng ở ${position.x},${position.y}, không tới được ${target.x},${target.y}`,
  );
}

/** Bước vào cổng: dừng cạnh cổng trước rồi mới đi vào ô cổng và chờ `S2C_ENTER_MAP` của bản đồ đích. */
async function crossPortal(
  world: World,
  portal: { x: number; y: number },
  targetMapId: string,
): Promise<{ position: { x: number; y: number }; enterMap: ServerEnterMap }> {
  const approach = { x: portal.x - PORTAL_APPROACH, y: portal.y };
  const standing = await walkTo(world.client, world.characterId, approach, world.position, 24);
  // Chưa chạm ô cổng thì chưa chuyển bản đồ: nếu đứng lọt vào ô cổng, gói `S2C_ENTER_MAP` sẽ tới sớm.
  expect(standing.x).toBeLessThan(portal.x);

  const mark = world.client.mark();
  world.client.send(Opcode.C2S_MOVE, portal);
  const enterMap = await waitEnterMap(
    world.client,
    mark,
    (payload) => payload.map.id === targetMapId,
  );
  expect(enterMap.map.id).toBe(targetMapId);
  return { position: { x: enterMap.entity.x, y: enterMap.entity.y }, enterMap };
}

/** Nói chuyện với một NPC (hoặc bấm một lựa chọn) và trả về gói hội thoại nhận được. */
async function talkTo(
  client: TestGameClient,
  npcId: string,
  optionId?: string,
): Promise<NpcDialog> {
  const mark = client.mark();
  client.send(Opcode.C2S_NPC_TALK, optionId === undefined ? { npcId } : { npcId, optionId });
  return waitDialog(client, mark, (payload) => payload.npcId === npcId);
}

// `waitForSince` nhận payload là `unknown`; mấy hàm dưới gói lại cho đúng kiểu từng gói để điều kiện
// trong bài test đọc được trường thật mà không phải ép kiểu ở mỗi chỗ gọi.
function waitQuestUpdate(
  client: TestGameClient,
  mark: number,
  predicate: (payload: QuestUpdate) => boolean,
): Promise<QuestUpdate> {
  return client.waitForSince<QuestUpdate>(mark, Opcode.S2C_QUEST_UPDATE, (payload) =>
    predicate(payload as QuestUpdate),
  );
}

function waitDialog(
  client: TestGameClient,
  mark: number,
  predicate: (payload: NpcDialog) => boolean,
): Promise<NpcDialog> {
  return client.waitForSince<NpcDialog>(mark, Opcode.S2C_NPC_DIALOG, (payload) =>
    predicate(payload as NpcDialog),
  );
}

function waitNotify(
  client: TestGameClient,
  mark: number,
  predicate: (payload: Notify) => boolean,
): Promise<Notify> {
  return client.waitForSince<Notify>(mark, Opcode.S2C_NOTIFY, (payload) =>
    predicate(payload as Notify),
  );
}

function waitEnterMap(
  client: TestGameClient,
  mark: number,
  predicate: (payload: ServerEnterMap) => boolean,
): Promise<ServerEnterMap> {
  return client.waitForSince<ServerEnterMap>(mark, Opcode.S2C_ENTER_MAP, (payload) =>
    predicate(payload as ServerEnterMap),
  );
}

function waitLevelUp(client: TestGameClient, mark: number): Promise<LevelUp> {
  return client.waitForSince<LevelUp>(mark, Opcode.S2C_LEVEL_UP, () => true);
}

/**
 * Đánh một con quái tới lúc trận kết thúc: `C2S_ATTACK_MOB` mở trận, `C2S_BATTLE_ACTION` cho mỗi lượt
 * của nhân vật. Mark lấy **trước** khi đánh để `waitForSince` bên ngoài chỉ thấy gói của trận này.
 */
async function fight(
  client: TestGameClient,
  characterId: string,
  targetId: string,
  mark: number,
): Promise<BattleEnd> {
  client.send(Opcode.C2S_ATTACK_MOB, { targetId });
  let from = mark;
  for (let step = 0; step < 40; step += 1) {
    const next = await client.nextPacket(
      [Opcode.S2C_BATTLE_START, Opcode.S2C_BATTLE_TURN, Opcode.S2C_BATTLE_END],
      from,
      15_000,
    );
    if (next === undefined) {
      // Quá hạn mà trận chưa đóng: dừng ngay để lỗi chỉ đúng chỗ, thay vì lặp cho hết vòng.
      const seen = client.since(mark).map((packet) => packet.op);
      throw new Error(`trận đánh với ${targetId} không kết thúc (đã nhận: ${seen.join(',')})`);
    }
    from = next.next;
    if (next.packet.op === Opcode.S2C_BATTLE_END) {
      return next.packet.payload as BattleEnd;
    }
    // Lượt đầu tiên đi kèm `S2C_BATTLE_START` (có `actorId`), các lượt sau là `S2C_BATTLE_TURN`:
    // cả hai đều phải được trả lời, nếu chỉ chờ `TURN` thì trận đứng im tới lúc hết giờ.
    const turn = next.packet.payload as BattleTurn;
    if (turn.actorId === characterId) {
      client.send(Opcode.C2S_BATTLE_ACTION, {
        battleId: turn.battleId,
        action: 'attack',
        targetId,
      });
    }
  }
  throw new Error(`trận đánh với ${targetId} không kết thúc`);
}

/** Chờ nhân vật đứng yên hẳn (không còn gói `ENTITY_MOVE`) trước khi đánh. */
async function stopMoving(client: TestGameClient, characterId: string): Promise<void> {
  let lastSeen = client.since(0).filter((packet) => packet.op === Opcode.S2C_ENTITY_MOVE).length;
  for (let round = 0; round < 40; round += 1) {
    await delay(100);
    const total = client.since(0).filter((packet) => packet.op === Opcode.S2C_ENTITY_MOVE).length;
    if (total === lastSeen) {
      return;
    }
    lastSeen = total;
  }
  throw new Error(`nhân vật vẫn di chuyển: ${characterId}`);
}

async function readYen(characterId: string): Promise<number> {
  const db = await getTestDb();
  const [row] = await db
    .select({ yen: characters.yen })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return row?.yen ?? -1;
}

describe('nhiệm vụ qua WebSocket', () => {
  it('nói chuyện, nhận rồi trả nhiệm vụ đầu: nhật ký đổi, lên cấp, hội thoại đang mở được gửi lại', async () => {
    const world = await enterWorld();

    // Bắt tay: chưa có nhiệm vụ đang làm, nhiệm vụ đầu nằm trong danh sách nhận được.
    expect(world.handshake.active).toEqual([]);
    expect(world.handshake.maxActive).toBe(5);
    expect(world.handshake.available.map((entry) => entry.questId)).toContain(CHAO_LANG);

    // Nói chuyện Thầy Hiệu Trưởng: hội thoại kèm nhiệm vụ nhận được ngay.
    const atHeadmaster = await walkTo(
      world.client,
      world.characterId,
      HEADMASTER_POS,
      world.position,
    );
    const firstDialog = await talkTo(world.client, HEADMASTER);
    expect(firstDialog.lines.length).toBeGreaterThan(0);
    const offer = firstDialog.quests.find((entry) => entry.questId === CHAO_LANG);
    expect(offer?.state).toBe('available');
    expect(offer?.giverName).toBe('Thầy Hiệu Trưởng');
    expect(offer?.objectives[0]?.progress).toBe(0);

    // Nhận nhiệm vụ: nhật ký đổi ngay, có dòng báo, và bảng hội thoại đang mở được gửi lại.
    const acceptMark = world.client.mark();
    world.client.send(Opcode.C2S_QUEST_ACCEPT, { questId: CHAO_LANG });
    const accepted = await waitQuestUpdate(world.client, acceptMark, (payload) =>
      payload.active.some((entry) => entry.questId === CHAO_LANG),
    );
    expect(accepted.available.map((entry) => entry.questId)).not.toContain(CHAO_LANG);
    const acceptNotify = await waitNotify(world.client, acceptMark, () => true);
    expect(acceptNotify.message).toContain('Chào làng');
    const afterAccept = await waitDialog(
      world.client,
      acceptMark,
      (payload) => payload.npcId === HEADMASTER,
    );
    // Khối nhiệm vụ trong hộp thoại đổi trạng thái ngay, nên nút "Nhận nhiệm vụ" không còn hiện nữa.
    expect(afterAccept.quests.find((entry) => entry.questId === CHAO_LANG)?.state).not.toBe(
      'available',
    );

    // Đi bộ tới Thầy Đồ và nói chuyện: mục tiêu `talk` xong, tiến độ đổi ngay trong lúc nói chuyện.
    const atTeacher = await walkTo(world.client, world.characterId, TEACHER_POS, atHeadmaster);
    const teacherMark = world.client.mark();
    await talkTo(world.client, TEACHER);
    const progressed = await waitQuestUpdate(world.client, teacherMark, (payload) =>
      payload.active.some((entry) => entry.questId === CHAO_LANG && entry.state === 'ready'),
    );
    const ready = progressed.active.find((entry) => entry.questId === CHAO_LANG);
    expect(ready?.objectives[0]?.progress).toBe(1);
    expect(ready?.objectives[0]?.done).toBe(true);

    // Quay lại trả nhiệm vụ: cộng kinh nghiệm/yên, lên cấp 2 (30 kinh nghiệm vừa đúng mốc).
    const backAtHeadmaster = await walkTo(
      world.client,
      world.characterId,
      HEADMASTER_POS,
      atTeacher,
    );
    await talkTo(world.client, HEADMASTER);
    const yenBefore = await readYen(world.characterId);
    const completeMark = world.client.mark();
    world.client.send(Opcode.C2S_QUEST_COMPLETE, { questId: CHAO_LANG });
    const completed = await waitQuestUpdate(world.client, completeMark, (payload) =>
      payload.completed.includes(CHAO_LANG),
    );
    const levelUp = await waitLevelUp(world.client, completeMark);
    expect(levelUp.levelsGained).toBe(1);
    expect(levelUp.character.level).toBe(2);
    const completeNotify = await waitNotify(world.client, completeMark, (payload) =>
      payload.message.includes('Đã trả nhiệm vụ'),
    );
    expect(completeNotify.message).toContain('Chào làng');
    expect(await readYen(world.characterId)).toBe(yenBefore + 50);

    // Nhiệm vụ kế tiếp hiện ngay trong bảng hội thoại vừa gửi lại — không phải đóng rồi bấm lại NPC.
    const nextDialog = await waitDialog(
      world.client,
      completeMark,
      (payload) => payload.npcId === HEADMASTER,
    );
    expect(nextDialog.quests.map((entry) => entry.questId)).toContain(DUONG_TOI_BAI_TAP);
    expect(nextDialog.quests.some((entry) => entry.questId === CHAO_LANG)).toBe(false);
    expect(completed.available.map((entry) => entry.questId)).toContain(DUONG_TOI_BAI_TAP);
    expect(Math.abs(backAtHeadmaster.y - HEADMASTER_POS.y)).toBeLessThanOrEqual(NEAR_NPC);
  });

  it('đi bộ qua cổng sang bãi luyện tập: mục tiêu `reach` xong khi vừa vào bản đồ', async () => {
    const world = await enterWorld({ completed: [CHAO_LANG] });

    const atHeadmaster = await walkTo(
      world.client,
      world.characterId,
      HEADMASTER_POS,
      world.position,
    );
    await talkTo(world.client, HEADMASTER);
    const acceptMark = world.client.mark();
    world.client.send(Opcode.C2S_QUEST_ACCEPT, { questId: DUONG_TOI_BAI_TAP });
    const accepted = await waitQuestUpdate(world.client, acceptMark, (payload) =>
      payload.active.some((entry) => entry.questId === DUONG_TOI_BAI_TAP),
    );
    expect(accepted.active.find((entry) => entry.questId === DUONG_TOI_BAI_TAP)?.state).toBe(
      'active',
    );

    const portalMark = world.client.mark();
    const inTraining = await crossPortal(world, TRAINING_PORTAL_POS, TRAINING);
    const reached = await waitQuestUpdate(world.client, portalMark, (payload) =>
      payload.active.some(
        (entry) => entry.questId === DUONG_TOI_BAI_TAP && entry.state === 'ready',
      ),
    );
    const ready = reached.active.find((entry) => entry.questId === DUONG_TOI_BAI_TAP);
    expect(ready?.objectives[0]?.progress).toBe(1);
    expect(inTraining.position.x).toBeGreaterThan(0);
    expect(Math.abs(atHeadmaster.y - HEADMASTER_POS.y)).toBeLessThanOrEqual(NEAR_NPC);
  });

  it('đánh thật hai con bù nhìn: mục tiêu `kill` xong, và mở lại kết nối vẫn còn tiến độ', async () => {
    const world = await enterWorld({ completed: [CHAO_LANG, DUONG_TOI_BAI_TAP] });

    const atHeadmaster = await walkTo(
      world.client,
      world.characterId,
      HEADMASTER_POS,
      world.position,
    );
    await talkTo(world.client, HEADMASTER);
    const acceptMark = world.client.mark();
    world.client.send(Opcode.C2S_QUEST_ACCEPT, { questId: BAI_HOC_DAU_TIEN });
    await waitQuestUpdate(world.client, acceptMark, (payload) =>
      payload.active.some((entry) => entry.questId === BAI_HOC_DAU_TIEN),
    );

    const inTraining = await crossPortal(world, TRAINING_PORTAL_POS, TRAINING);
    // Lấy chính id/toạ độ quái từ danh sách thực thể của bản đồ, không đoán theo thứ tự trong file:
    // id của room (`mob:<map>:<n>`) do server sinh, không phải id dữ liệu.
    const monsters = inTraining.enterMap.entities
      .filter((entity) => entity.kind === 'monster')
      .map((entity) => ({ id: entity.id, pos: { x: entity.x, y: entity.y } }))
      .sort(
        (left, right) =>
          Math.hypot(left.pos.x - inTraining.position.x, left.pos.y - inTraining.position.y) -
          Math.hypot(right.pos.x - inTraining.position.x, right.pos.y - inTraining.position.y),
      );
    expect(monsters.length).toBeGreaterThanOrEqual(2);
    const firstTarget = monsters[0];
    const secondTarget = monsters[1];
    expect(firstTarget?.id).not.toBe(secondTarget?.id);

    const mapMark = world.client.mark();
    const atFirstScarecrow = await walkTo(
      world.client,
      world.characterId,
      firstTarget?.pos ?? SCARECROW_ONE.pos,
      inTraining.position,
      NEAR_MONSTER,
    );

    // Con thứ nhất: mục tiêu nhảy lên 1/2 nhưng nhiệm vụ chưa xong.
    await stopMoving(world.client, world.characterId);
    const firstMark = world.client.mark();
    const firstId = String(firstTarget?.id);
    const firstFight = await fight(world.client, world.characterId, firstId, firstMark);
    expect(firstFight.outcome).toBe('victory');
    const afterFirst = await waitQuestUpdate(world.client, firstMark, (payload) =>
      payload.active.some(
        (entry) => entry.questId === BAI_HOC_DAU_TIEN && entry.objectives[0]?.progress === 1,
      ),
    );
    expect(afterFirst.active[0]?.state).toBe('active');

    const secondHome = secondTarget?.pos ?? SCARECROW_TWO.pos;
    const atSecondScarecrow = await walkTo(
      world.client,
      world.characterId,
      latestEntity(world.client, String(secondTarget?.id), mapMark, secondHome),
      atFirstScarecrow,
      NEAR_MONSTER,
    );
    const secondMark = world.client.mark();
    const secondId = String(secondTarget?.id);
    await stopMoving(world.client, world.characterId);
    const secondFight = await fight(world.client, world.characterId, secondId, secondMark);
    expect(secondFight.outcome).toBe('victory');
    const finished = await waitQuestUpdate(world.client, secondMark, (payload) =>
      payload.active.some((entry) => entry.questId === BAI_HOC_DAU_TIEN && entry.state === 'ready'),
    );
    expect(finished.active[0]?.objectives[0]?.progress).toBe(2);
    expect(Math.abs(atSecondScarecrow.x - secondHome.x)).toBeLessThanOrEqual(NEAR_MONSTER);

    // Mở kết nối mới cùng nhân vật: nhật ký sau bắt tay vẫn còn nhiệm vụ đang làm kèm tiến độ.
    world.client.close();
    clients = clients.filter((client) => client !== world.client);
    await delay(40);

    const again = await TestGameClient.connect(server.wsUrl);
    clients.push(again);
    await again.hello({ access: world.access, characterId: world.characterId });
    const rejoin = await again.waitFor<QuestUpdate>(Opcode.S2C_QUEST_UPDATE);
    const resumed = rejoin.active.find((entry) => entry.questId === BAI_HOC_DAU_TIEN);
    expect(resumed?.state).toBe('ready');
    expect(resumed?.objectives[0]?.progress).toBe(2);
    expect(atHeadmaster.y).toBeDefined();
  });

  it('túi đầy: nhiệm vụ vẫn trả xong và có dòng báo món quà bị mất', async () => {
    const world = await enterWorld({
      completed: [CHAO_LANG, DUONG_TOI_BAI_TAP],
      active: [{ questId: BAI_HOC_DAU_TIEN, progress: [2] }],
    });
    // 40 hàng chiếm hết túi trước khi trả nhiệm vụ có thưởng vật phẩm; bỏ sẵn món thưởng nếu có, để
    // phần thưởng phải mở hàng mới — đúng trường hợp túi đầy.
    await fillBag(world.characterId, 40);
    const db = await getTestDb();
    await db
      .delete(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, world.characterId),
          eq(inventoryItems.itemId, 'item-banh-bao'),
        ),
      );

    await walkTo(world.client, world.characterId, HEADMASTER_POS, world.position);
    await talkTo(world.client, HEADMASTER);
    const completeMark = world.client.mark();
    world.client.send(Opcode.C2S_QUEST_COMPLETE, { questId: BAI_HOC_DAU_TIEN });
    const completed = await waitQuestUpdate(world.client, completeMark, (payload) =>
      payload.completed.includes(BAI_HOC_DAU_TIEN),
    );
    expect(completed.completed).toContain(BAI_HOC_DAU_TIEN);
    const lost = await waitNotify(world.client, completeMark, (payload) =>
      payload.message.includes('bị mất'),
    );
    expect(lost.message).toContain('Bánh Bao Hấp');

    const stored = await db
      .select({ itemId: inventoryItems.itemId })
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, world.characterId));
    expect(stored.some((row) => row.itemId === 'item-banh-bao')).toBe(false);
  });

  it('lựa chọn hội thoại: nhánh có `next` mở tiếp, nhánh kết thúc thì server im lặng', async () => {
    // Nhân vật xong 11 nhiệm vụ và đang giữ nhiệm vụ cuối chưa xong mục tiêu `talk`.
    const world = await enterWorld({
      completed: BEFORE_BAI_SU,
      active: [{ questId: BAI_SU, progress: [0] }],
      level: 3,
    });

    const atMaster = await walkTo(world.client, world.characterId, MASTER_POS, world.position);
    // Nói chuyện: tiến độ cộng **trước** khi chọn nhánh, nên nhánh "đã xong" hiện ra ngay lần đầu.
    const talkMark = world.client.mark();
    const dialog = await talkTo(world.client, MASTER);
    const progressed = await waitQuestUpdate(world.client, talkMark, (payload) =>
      payload.active.some(
        (entry) => entry.questId === BAI_SU && entry.objectives[0]?.progress === 1,
      ),
    );
    expect(progressed.active[0]?.state).toBe('ready');
    expect(dialog.nodeId).toBe('bai-su');
    expect(dialog.quests.some((entry) => entry.questId === BAI_SU)).toBe(true);

    // Lựa chọn có `next`: mở nhánh nói tiếp trong cùng cuộc hội thoại.
    const continues = dialog.options.find((option) => option.next !== null);
    expect(continues).toBeDefined();
    const branch = await talkTo(world.client, MASTER, continues?.id);
    expect(branch.nodeId).toBe(continues?.next);

    // Lựa chọn không có `next`: kết thúc hội thoại, server không gửi gì nữa (client tự đóng).
    const closing = branch.options.find((option) => option.next === null);
    expect(closing).toBeDefined();
    const quietMark = world.client.mark();
    world.client.send(Opcode.C2S_NPC_TALK, { npcId: MASTER, optionId: closing?.id });
    await delay(150);
    expect(world.client.since(quietMark, Opcode.S2C_NPC_DIALOG)).toEqual([]);

    // Hội thoại đã đóng mà vẫn gửi `optionId` → `dialog_not_open`.
    world.client.send(Opcode.C2S_NPC_TALK, { npcId: MASTER, optionId: continues?.id });
    const error = await world.client.waitForError();
    expect(error.code).toBe('dialog_not_open');
    expect(Math.abs(atMaster.y - MASTER_POS.y)).toBeLessThanOrEqual(NEAR_NPC);
  });

  it('gửi `optionId` khi chưa mở hội thoại thì bị từ chối bằng `dialog_not_open`', async () => {
    const world = await enterWorld({ completed: BEFORE_BAI_SU, level: 3 });
    await walkTo(world.client, world.characterId, MASTER_POS, world.position);
    world.client.send(Opcode.C2S_NPC_TALK, { npcId: MASTER, optionId: 'khong-co-lua-chon-nay' });
    const error = await world.client.waitForError();
    expect(error.code).toBe('dialog_not_open');
  });

  it('đang trong trận thì nhận hay trả nhiệm vụ đều bị chặn bằng `in_battle`', async () => {
    const world = await enterWorld();

    const inTraining = await crossPortal(world, TRAINING_PORTAL_POS, TRAINING);
    const target = inTraining.enterMap.entities
      .filter((entity) => entity.kind === 'monster')
      .map((entity) => ({ id: entity.id, pos: { x: entity.x, y: entity.y } }))
      .sort(
        (left, right) =>
          Math.hypot(left.pos.x - inTraining.position.x, left.pos.y - inTraining.position.y) -
          Math.hypot(right.pos.x - inTraining.position.x, right.pos.y - inTraining.position.y),
      )[0];
    expect(target).toBeDefined();
    await walkTo(
      world.client,
      world.characterId,
      target?.pos ?? SCARECROW_ONE.pos,
      inTraining.position,
      NEAR_MONSTER,
    );
    await stopMoving(world.client, world.characterId);

    const battleMark = world.client.mark();
    world.client.send(Opcode.C2S_ATTACK_MOB, { targetId: String(target?.id) });
    const start = await world.client.waitFor<BattleTurn>(Opcode.S2C_BATTLE_START);
    expect(start.battleId).toBeTruthy();

    // Lúc này nhân vật **chưa** nói chuyện với NPC nào, nên nếu không có chặn `in_battle` thì lỗi sẽ là
    // `quest_wrong_npc`; nhận được `in_battle` chứng minh trần chặn chạy trước mọi kiểm tra nhiệm vụ.
    const acceptMark = world.client.mark();
    world.client.send(Opcode.C2S_QUEST_ACCEPT, { questId: CHAO_LANG });
    const acceptError = await world.client.waitForError();
    expect(acceptError.code).toBe(ErrorCode.IN_BATTLE);
    expect(acceptError.fatal).toBe(false);

    world.client.send(Opcode.C2S_QUEST_COMPLETE, { questId: CHAO_LANG });
    const completeError = await world.client.waitForError();
    expect(completeError.code).toBe(ErrorCode.IN_BATTLE);
    expect(completeError.fatal).toBe(false);

    // Không nhật ký nào bị gửi nhầm: cả hai lệnh đều bị chặn trước khi chạm tới nhiệm vụ.
    expect(world.client.since(acceptMark, Opcode.S2C_QUEST_UPDATE)).toEqual([]);
    expect(world.client.since(battleMark, Opcode.S2C_QUEST_UPDATE)).toEqual([]);
  });
});

describe('cây hội thoại với nhánh mới trong game-data', () => {
  it('nhánh không `when` chỉ tới được bằng `next`, lựa chọn kết thúc thì không gửi gì', async () => {
    // Bản sao game-data có thêm hai nhánh của Thầy Hiệu Trưởng: nhánh theo trạng thái nhiệm vụ và
    // nhánh nói tiếp không có `when` (chỉ `next` mới tới được).
    const dir = await copyGameDataDir((files) => {
      files.npcs['npcs/npc-thay-hieu-truong.json'] = {
        id: HEADMASTER,
        name: 'Thầy Hiệu Trưởng',
        color: '#f2c14e',
        lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Chào con.' }],
        shop: [],
        dialog: [
          {
            id: 'giao-chao-lang',
            when: { questId: CHAO_LANG, state: 'active' },
            lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Con tới chào Thầy Đồ đi.' }],
            options: [
              { id: 'hoi-thay-do', text: 'Thầy Đồ là ai ạ?', next: 'ke-ve-thay-do' },
              { id: 'di-ngay', text: 'Vâng, con đi ngay.' },
            ],
          },
          {
            id: 'ke-ve-thay-do',
            lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Thầy Đồ dạy võ ở cuối làng.' }],
            options: [{ id: 'cam-on', text: 'Con cảm ơn thầy.' }],
          },
        ],
      };
    });
    const fixture = await startTestServer({ gameDataDir: dir });
    try {
      const { access, characterId } = await accountWithCharacter(
        fixture.app,
        'dialog_user',
        'HoiThoai',
      );
      const client = await TestGameClient.connect(fixture.wsUrl);
      clients.push(client);
      const { enterMap } = await client.hello({ access, characterId });
      await client.waitFor<CharacterStats>(Opcode.S2C_CHARACTER);
      expect(enterMap.map.id).toBe(VILLAGE);

      // Nhận nhiệm vụ đầu để nhánh `giao-chao-lang` (state active) khớp.
      await walkTo(client, characterId, HEADMASTER_POS, {
        x: enterMap.entity.x,
        y: enterMap.entity.y,
      });
      await talkTo(client, HEADMASTER);
      const acceptMark = client.mark();
      client.send(Opcode.C2S_QUEST_ACCEPT, { questId: CHAO_LANG });
      await waitQuestUpdate(client, acceptMark, (payload) =>
        payload.active.some((entry) => entry.questId === CHAO_LANG),
      );

      const dialog = await talkTo(client, HEADMASTER);
      expect(dialog.nodeId).toBe('giao-chao-lang');
      expect(dialog.options.map((option) => option.id)).toEqual(['hoi-thay-do', 'di-ngay']);
      expect(dialog.options.map((option) => option.next)).toEqual(['ke-ve-thay-do', null]);

      const branch = await talkTo(client, HEADMASTER, 'hoi-thay-do');
      expect(branch.nodeId).toBe('ke-ve-thay-do');
      expect(branch.lines.map((line) => line.text)).toEqual(['Thầy Đồ dạy võ ở cuối làng.']);

      const quietMark = client.mark();
      client.send(Opcode.C2S_NPC_TALK, { npcId: HEADMASTER, optionId: 'cam-on' });
      await delay(150);
      expect(client.since(quietMark, Opcode.S2C_NPC_DIALOG)).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});

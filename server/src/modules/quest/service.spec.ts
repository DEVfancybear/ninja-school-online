import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { MAX_ACTIVE_QUESTS, INVENTORY_CAPACITY, expToNextLevel, type Quest } from '@ninja/shared';
import {
  characterFeatures,
  characterQuests,
  characters as characterTable,
  inventoryItems,
} from '../../db/schema.js';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import { copyGameDataDir, removeTemporaryGameDataDirs } from '../../test/game-data-dir.js';
import {
  fillBag,
  giveItem,
  makeCharacter,
  readItemRow,
  readYen,
} from '../../test/character-fixture.js';
import { DEFAULT_GAME_DATA_DIR, loadGameData, type GameData } from '../../world/game-data.js';
import { CharacterService } from '../character/service.js';
import { InventoryService } from '../inventory/service.js';
import { QuestService, type QuestAcceptOutcome, type QuestCompleteOutcome } from './service.js';

const VILLAGE = 'lang-khoi-nguon';
const TRAINING = 'bai-luyen-tap';
const HEADMASTER = 'npc-thay-hieu-truong';
const TEACHER = 'npc-thay-do';

/**
 * Thứ tự chơi được của 12 nhiệm vụ chương 1: nhiệm vụ nào cũng đứng sau mọi nhiệm vụ nó phụ thuộc.
 * Hai nhánh (Thầy Đồ và luyện thú) chạy nối tiếp nhau cho tới khi gặp lại ở nhiệm vụ cuối.
 */
const CHAPTER_ONE = [
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
  'quest-bai-su',
] as const;

type CompleteOk = Extract<QuestCompleteOutcome, { ok: true }>;
type Reject = Extract<QuestCompleteOutcome, { ok: false }>;

let gameData: GameData;
let inventory: InventoryService;
let characters: CharacterService;
let quests: QuestService;
let characterId: string;

beforeEach(async () => {
  await resetDatabase();
  const db = await getTestDb();
  gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  inventory = new InventoryService(db, gameData);
  characters = new CharacterService(db, inventory, gameData);
  quests = new QuestService(db, gameData, characters, inventory);
  characterId = await makeCharacter({ yen: 200, level: 1 });
});

afterAll(async () => {
  await closeTestDb();
  await removeTemporaryGameDataDirs();
});

/** Kết quả **phải** được nhận, để test đọc thẳng phần thưởng. */
function expectAcceptOk(outcome: QuestAcceptOutcome): Extract<QuestAcceptOutcome, { ok: true }> {
  if (!outcome.ok) {
    throw new Error(
      `mong đợi nhận được nhiệm vụ nhưng bị từ chối: ${outcome.code} — ${outcome.message}`,
    );
  }
  return outcome;
}

/** Kết quả **phải** trả xong, để test đọc thẳng tiến độ và phần thưởng. */
function expectCompleteOk(outcome: QuestCompleteOutcome): CompleteOk {
  if (!outcome.ok) {
    throw new Error(
      `mong đợi trả xong nhiệm vụ nhưng bị từ chối: ${outcome.code} — ${outcome.message}`,
    );
  }
  return outcome;
}

/** Kết quả **phải** bị từ chối, để test đọc thẳng mã lỗi. */
function expectReject(outcome: QuestAcceptOutcome | QuestCompleteOutcome): Reject {
  if (outcome.ok) {
    throw new Error('mong đợi bị từ chối nhưng lần gọi lại thành công');
  }
  return outcome;
}

function quest(id: string): Quest {
  const found = gameData.quests.get(id);
  if (found === undefined) {
    throw new Error(`game-data thiếu nhiệm vụ ${id}`);
  }
  return found;
}

/** Cấp/kinh nghiệm đang lưu trong database — test tự đọc thay vì tin vào giá trị service trả về. */
async function readLevelAndExp(id: string): Promise<{ level: number; exp: number }> {
  const db = await getTestDb();
  const [row] = await db
    .select({ level: characterTable.level, exp: characterTable.exp })
    .from(characterTable)
    .where(eq(characterTable.id, id))
    .limit(1);
  return { level: row?.level ?? 0, exp: row?.exp ?? 0 };
}

async function featureRows(id: string): Promise<string[]> {
  const db = await getTestDb();
  const rows = await db
    .select({ feature: characterFeatures.feature })
    .from(characterFeatures)
    .where(eq(characterFeatures.characterId, id));
  return rows.map((row) => row.feature);
}

async function questRows(id: string): Promise<{ questId: string; status: string }[]> {
  const db = await getTestDb();
  return db
    .select({ questId: characterQuests.questId, status: characterQuests.status })
    .from(characterQuests)
    .where(eq(characterQuests.characterId, id));
}

/** Tiến độ mục tiêu đầu tiên của nhiệm vụ, đọc qua `view()` (đúng thứ client nhìn thấy). */
async function firstObjective(
  id: string,
  questId: string,
): Promise<{ progress: number; done: boolean }> {
  const view = await quests.view(id, questId);
  const objective = view?.objectives[0];
  if (objective === undefined) {
    throw new Error(`không đọc được mục tiêu của ${questId}`);
  }
  return { progress: objective.progress, done: objective.done };
}

/** Giả tiến độ mọi mục tiêu của một nhiệm vụ, đúng cách sự kiện trong thế giới vẫn làm. */
async function fakeProgress(id: string, current: Quest): Promise<void> {
  for (const objective of current.objectives) {
    switch (objective.kind) {
      case 'talk':
        for (let index = 0; index < objective.count; index += 1) {
          expect(await quests.progressTalk(id, objective.targetId)).toBe(true);
        }
        break;
      case 'kill':
        for (let index = 0; index < objective.count; index += 1) {
          expect(await quests.progressKill(id, objective.targetId)).toBe(true);
        }
        break;
      case 'reach':
        for (let index = 0; index < objective.count; index += 1) {
          expect(await quests.progressReach(id, objective.targetId)).toBe(true);
        }
        break;
      case 'collect': {
        await topUpItem(id, objective.targetId, objective.count);
        break;
      }
    }
  }
}

/**
 * Cất thêm món cho đủ `target` món trong túi. Khác `giveItem` ở chỗ chịu được hàng đã có sẵn:
 * bảng `inventory_items` chỉ cho một hàng cho mỗi món, nên cất thêm là cộng vào số lượng.
 */
async function topUpItem(id: string, itemId: string, target: number): Promise<void> {
  const held = (await readItemRow(id, itemId))?.quantity ?? 0;
  if (held >= target) {
    return;
  }
  const missing = target - held;
  await (
    await getTestDb()
  )
    .insert(inventoryItems)
    .values({ characterId: id, itemId, quantity: missing })
    .onConflictDoUpdate({
      target: [inventoryItems.characterId, inventoryItems.itemId],
      set: { quantity: sql`${inventoryItems.quantity} + ${missing}` },
    });
}

/** Ghi trước vài nhiệm vụ ở trạng thái đã trả, để test vào thẳng nhiệm vụ cần kiểm. */
async function markCompleted(id: string, questIds: readonly string[]): Promise<void> {
  const db = await getTestDb();
  for (const questId of questIds) {
    const current = quest(questId);
    await db.insert(characterQuests).values({
      characterId: id,
      questId,
      status: 'completed',
      progress: current.objectives.map((objective) => objective.count),
      completedAt: new Date(),
    });
  }
}

describe('QuestService — chạy hết chương 1', () => {
  it('chạy đủ 12 nhiệm vụ theo thứ tự, mỗi bước cộng đúng thưởng và lưu vào database', async () => {
    let expectedExp = 0;

    for (const questId of CHAPTER_ONE) {
      const current = quest(questId);

      // Chưa nhận thì nhiệm vụ phải nằm trong danh sách nhận được (đủ cấp và đủ nhiệm vụ trước).
      const before = await quests.state(characterId);
      expect(before.available.map((entry) => entry.questId)).toContain(questId);

      const accepted = expectAcceptOk(
        await quests.accept(characterId, questId, current.giverNpcId, VILLAGE),
      );
      expect(accepted.name).toBe(current.name);
      expect((await quests.view(characterId, questId))?.state).not.toBe('available');

      await fakeProgress(characterId, current);
      expect((await quests.view(characterId, questId))?.state).toBe('ready');

      const yenBefore = await readYen(characterId);
      const outcome = expectCompleteOk(
        await quests.complete(characterId, questId, current.turnInNpcId),
      );

      expectedExp += current.rewards.exp;
      expect(await readYen(characterId)).toBe(yenBefore + current.rewards.yen);
      expect(outcome.exp).toBe(current.rewards.exp);
      expect(outcome.yen).toBe(current.rewards.yen);
      expect(outcome.lostItems).toEqual([]);
      // Bất biến của bảng cấp: chưa đủ mốc lên cấp kế tiếp thì cấp chưa đổi.
      const after = await readLevelAndExp(characterId);
      expect(after.exp).toBeLessThan(expToNextLevel(after.level));

      // Món quà nằm trong túi; nhiệm vụ không còn đang làm và đã vào danh sách đã trả.
      for (const item of current.rewards.items) {
        expect((await readItemRow(characterId, item.itemId))?.quantity ?? 0).toBeGreaterThanOrEqual(
          item.quantity,
        );
      }
      const state = await quests.state(characterId);
      expect(state.active.map((entry) => entry.questId)).not.toContain(questId);
      expect(state.completed).toContain(questId);
      expect((await questRows(characterId)).find((row) => row.questId === questId)?.status).toBe(
        'completed',
      );
    }

    // Tổng thưởng chương 1: 1710 yên và 1260 kinh nghiệm; 200 yên ban đầu nên còn 1910 yên.
    expect(expectedExp).toBe(1260);
    expect(await readYen(characterId)).toBe(1910);
    // 1260 kinh nghiệm vượt mốc cấp 7 (30+76+132+195+263+337 = 1033 theo bảng `expToNextLevel`) nên
    // nhân vật đứng ở cấp 7 với 227 kinh nghiệm dư; không đồng nào kinh nghiệm bị mất qua 12 nhiệm vụ.
    expect(await readLevelAndExp(characterId)).toEqual({ level: 7, exp: 227 });

    // Cờ tính năng ghi đúng ở hai nhiệm vụ có `unlocks`, theo thứ tự mở (party ở nhiệm vụ giết chuột
    // đồng, arena ở nhiệm vụ cuối) và mỗi cờ chỉ một hàng.
    expect((await featureRows(characterId)).sort()).toEqual(['arena', 'party']);
    expect(await quests.hasFeature(characterId, 'party')).toBe(true);
    expect(await quests.hasFeature(characterId, 'arena')).toBe(true);
    expect(await quests.hasFeature(characterId, 'khong-co-that')).toBe(false);

    const finalState = await quests.state(characterId);
    expect(finalState.unlockedFeatures).toEqual(['party', 'arena']);
    expect(finalState.active).toEqual([]);
    // Không nhiệm vụ nào trong game-data là không tới được: chuỗi 12 nhiệm vụ chạy trọn, không kẹt.
    expect([...finalState.completed].sort()).toEqual([...gameData.quests.keys()].sort());
  });
});

describe('QuestService — luật nhận nhiệm vụ', () => {
  it('thiếu nhiệm vụ trước thì bị chặn và nói rõ nhiệm vụ nào', async () => {
    const outcome = expectReject(
      await quests.accept(characterId, 'quest-bai-hoc-dau-tien', HEADMASTER, VILLAGE),
    );
    expect(outcome.code).toBe('quest_locked');
    expect(outcome.message).toContain('Đường tới bãi tập');
    expect((await questRows(characterId)).length).toBe(0);
  });

  it('chưa đủ cấp thì bị chặn và nói rõ cấp cần', async () => {
    const outcome = expectReject(
      await quests.accept(characterId, 'quest-loi-thay-day', HEADMASTER, VILLAGE),
    );
    expect(outcome.code).toBe('quest_locked');
    expect(outcome.message).toContain('cấp 3');
  });

  it('nhận hai lần thì báo đang làm rồi', async () => {
    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    const outcome = expectReject(
      await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE),
    );
    expect(outcome.code).toBe('quest_already_active');
  });

  it('sai người giao thì báo quest_wrong_npc và chỉ đúng NPC', async () => {
    const outcome = expectReject(
      await quests.accept(characterId, 'quest-chao-lang', TEACHER, VILLAGE),
    );
    expect(outcome.code).toBe('quest_wrong_npc');
    expect(outcome.message).toContain('Thầy Hiệu Trưởng');
  });

  it('nhiệm vụ không có trong game-data thì báo quest_not_found', async () => {
    expect(
      expectReject(await quests.accept(characterId, 'quest-khong-ton-tai', HEADMASTER, VILLAGE))
        .code,
    ).toBe('quest_not_found');
    expect(
      expectReject(await quests.complete(characterId, 'quest-khong-ton-tai', HEADMASTER)).code,
    ).toBe('quest_not_found');
  });

  it(`đang làm đủ ${MAX_ACTIVE_QUESTS} nhiệm vụ thì không nhận thêm được`, async () => {
    const fixture = await loadGameData(
      await copyGameDataDir((files) => {
        for (let index = 1; index <= MAX_ACTIVE_QUESTS + 1; index += 1) {
          const id = `quest-thu-nghiem-${index}`;
          files.quests[`quests/${id}.json`] = {
            id,
            name: `Thử nghiệm ${index}`,
            chapter: 9,
            summary: `Nhiệm vụ thử trần ${MAX_ACTIVE_QUESTS} nhiệm vụ song song`,
            giverNpcId: HEADMASTER,
            turnInNpcId: HEADMASTER,
            requiresQuests: [],
            objectives: [{ kind: 'talk', targetId: TEACHER, count: 1, description: 'Ghé thầy đồ' }],
            rewards: { exp: 0, yen: 0, items: [] },
          };
        }
      }),
    );
    const limited = new QuestService(await getTestDb(), fixture, characters, inventory);

    for (let index = 1; index <= MAX_ACTIVE_QUESTS; index += 1) {
      expectAcceptOk(
        await limited.accept(characterId, `quest-thu-nghiem-${index}`, HEADMASTER, VILLAGE),
      );
    }
    const outcome = expectReject(
      await limited.accept(
        characterId,
        `quest-thu-nghiem-${MAX_ACTIVE_QUESTS + 1}`,
        HEADMASTER,
        VILLAGE,
      ),
    );
    expect(outcome.code).toBe('quest_too_many');
    const state = await limited.state(characterId);
    expect(state.active.length).toBe(MAX_ACTIVE_QUESTS);
    expect(state.maxActive).toBe(MAX_ACTIVE_QUESTS);
  });
});

describe('QuestService — luật trả nhiệm vụ', () => {
  it('trả khi chưa xong mục tiêu thì báo quest_not_ready kèm tiến độ', async () => {
    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    const outcome = expectReject(await quests.complete(characterId, 'quest-chao-lang', HEADMASTER));
    expect(outcome.code).toBe('quest_not_ready');
    expect(outcome.message).toContain('0/1');
  });

  it('trả nhiệm vụ chưa nhận thì báo quest_not_ready', async () => {
    const outcome = expectReject(await quests.complete(characterId, 'quest-chao-lang', HEADMASTER));
    expect(outcome.code).toBe('quest_not_ready');
    expect(outcome.message).toContain('chưa nhận');
  });

  it('trả ở sai NPC thì báo quest_wrong_npc và chỉ đúng NPC', async () => {
    // Cấp 3 để mở được nhiệm vụ cuối (nhiệm vụ trước đã trả, nhưng cấp là điều kiện riêng).
    const hero = await makeCharacter({ level: 3, yen: 200 });
    await markCompleted(hero, [
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
    ]);
    expectAcceptOk(await quests.accept(hero, 'quest-bai-su', HEADMASTER, VILLAGE));
    await fakeProgress(hero, quest('quest-bai-su'));

    const outcome = expectReject(await quests.complete(hero, 'quest-bai-su', HEADMASTER));
    expect(outcome.code).toBe('quest_wrong_npc');
    expect(outcome.message).toContain('Sư Phụ');
  });

  it('nhiệm vụ đã trả rồi thì báo quest_already_done ở cả hai chiều', async () => {
    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    await fakeProgress(characterId, quest('quest-chao-lang'));
    expectCompleteOk(await quests.complete(characterId, 'quest-chao-lang', HEADMASTER));
    expect(
      expectReject(await quests.complete(characterId, 'quest-chao-lang', HEADMASTER)).code,
    ).toBe('quest_already_done');
    expect(
      expectReject(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE)).code,
    ).toBe('quest_already_done');
  });
});

describe('QuestService — mục tiêu collect', () => {
  it('đếm món đang có trong túi và không tiêu món khi trả', async () => {
    // Vào thẳng nhiệm vụ thứ tư bằng cách ghi trước ba nhiệm vụ trước ở trạng thái đã trả.
    await markCompleted(characterId, [
      'quest-chao-lang',
      'quest-duong-toi-bai-tap',
      'quest-bai-hoc-dau-tien',
    ]);
    await topUpItem(characterId, 'item-da-vun', 1);
    expectAcceptOk(await quests.accept(characterId, 'quest-nhat-da-vun', TEACHER, VILLAGE));

    expect((await quests.view(characterId, 'quest-nhat-da-vun'))?.state).toBe('active');
    await topUpItem(characterId, 'item-da-vun', 2);
    expect(await firstObjective(characterId, 'quest-nhat-da-vun')).toEqual({
      progress: 2,
      done: true,
    });
    // Túi vừa đủ là mở hội thoại đã thấy `ready` ngay — không phải nhận lại nhiệm vụ mới đếm.
    expect((await quests.dialogStates(characterId)).get('quest-nhat-da-vun')).toBe('ready');
    expect(
      (await quests.state(characterId)).active.find(
        (entry) => entry.questId === 'quest-nhat-da-vun',
      )?.state,
    ).toBe('ready');

    expectCompleteOk(await quests.complete(characterId, 'quest-nhat-da-vun', TEACHER));
    // Mục tiêu `collect` chỉ đếm chứ không tiêu: hai món vẫn còn nguyên trong túi.
    expect((await readItemRow(characterId, 'item-da-vun'))?.quantity).toBe(2);
  });

  it('món đang mặc không được tính vào mục tiêu collect', async () => {
    await markCompleted(characterId, [
      'quest-chao-lang',
      'quest-duong-toi-bai-tap',
      'quest-bai-hoc-dau-tien',
    ]);
    // Hai đá vụn nhưng đang mặc trên người: hàng có `equipped_slot` khác null nên không tính.
    await giveItem(characterId, 'item-da-vun', { quantity: 2, slot: 'weapon' });
    expectAcceptOk(await quests.accept(characterId, 'quest-nhat-da-vun', TEACHER, VILLAGE));
    expect(await firstObjective(characterId, 'quest-nhat-da-vun')).toEqual({
      progress: 0,
      done: false,
    });

    // Cởi ra thì đúng hai món đó được tính lại ngay, không cần nhặt thêm gì.
    await unequip(characterId, 'item-da-vun');
    expect(await firstObjective(characterId, 'quest-nhat-da-vun')).toEqual({
      progress: 2,
      done: true,
    });
  });
});

describe('QuestService — mục tiêu reach', () => {
  it('nhận nhiệm vụ lúc đang đứng ở bản đồ đích thì xong mục tiêu ngay', async () => {
    await markCompleted(characterId, ['quest-chao-lang']);
    expectAcceptOk(
      await quests.accept(characterId, 'quest-duong-toi-bai-tap', HEADMASTER, TRAINING),
    );
    expect(await firstObjective(characterId, 'quest-duong-toi-bai-tap')).toEqual({
      progress: 1,
      done: true,
    });
    expect((await quests.view(characterId, 'quest-duong-toi-bai-tap'))?.state).toBe('ready');
    expect(
      expectCompleteOk(await quests.complete(characterId, 'quest-duong-toi-bai-tap', HEADMASTER))
        .exp,
    ).toBe(40);
  });

  it('nhận ở bản đồ khác thì chưa xong, phải đi tới bản đồ đích', async () => {
    await markCompleted(characterId, ['quest-chao-lang']);
    expectAcceptOk(
      await quests.accept(characterId, 'quest-duong-toi-bai-tap', HEADMASTER, VILLAGE),
    );
    expect(await firstObjective(characterId, 'quest-duong-toi-bai-tap')).toEqual({
      progress: 0,
      done: false,
    });
    expect(await quests.progressReach(characterId, 'khong-co-that')).toBe(false);
    expect(await quests.progressReach(characterId, TRAINING)).toBe(true);
    expect(await firstObjective(characterId, 'quest-duong-toi-bai-tap')).toEqual({
      progress: 1,
      done: true,
    });
  });
});

describe('QuestService — tiến độ chỉ cộng khi nhiệm vụ đang làm', () => {
  it('sự kiện xảy ra trước khi nhận nhiệm vụ không được tính', async () => {
    // Đánh quái/ghé NPC/khoác bản đồ khi chưa nhận nhiệm vụ: không hàng nào đổi nên trả về `false`.
    expect(await quests.progressKill(characterId, 'mob-bui-nhon')).toBe(false);
    expect(await quests.progressTalk(characterId, TEACHER)).toBe(false);
    expect(await quests.progressReach(characterId, VILLAGE)).toBe(false);

    await markCompleted(characterId, ['quest-chao-lang', 'quest-duong-toi-bai-tap']);
    expectAcceptOk(await quests.accept(characterId, 'quest-bai-hoc-dau-tien', HEADMASTER, VILLAGE));
    expect(await firstObjective(characterId, 'quest-bai-hoc-dau-tien')).toEqual({
      progress: 0,
      done: false,
    });
    // Giết con khác thì không cộng; giết đúng loại thì cộng.
    expect(await quests.progressKill(characterId, 'mob-heo-rung')).toBe(false);
    expect(await quests.progressKill(characterId, 'mob-bui-nhon')).toBe(true);
    expect(await firstObjective(characterId, 'quest-bai-hoc-dau-tien')).toEqual({
      progress: 1,
      done: false,
    });
  });

  it('hạ đủ số quái thì mục tiêu xong và không cộng quá trần', async () => {
    await markCompleted(characterId, ['quest-chao-lang', 'quest-duong-toi-bai-tap']);
    expectAcceptOk(await quests.accept(characterId, 'quest-bai-hoc-dau-tien', HEADMASTER, VILLAGE));
    await quests.progressKill(characterId, 'mob-bui-nhon');
    await quests.progressKill(characterId, 'mob-bui-nhon');
    expect(await firstObjective(characterId, 'quest-bai-hoc-dau-tien')).toEqual({
      progress: 2,
      done: true,
    });
    // Con thứ ba không đẩy số đếm vượt trần `count`.
    expect(await quests.progressKill(characterId, 'mob-bui-nhon')).toBe(false);
    expect(await firstObjective(characterId, 'quest-bai-hoc-dau-tien')).toEqual({
      progress: 2,
      done: true,
    });
  });
});

describe('QuestService — thưởng', () => {
  it('thưởng kinh nghiệm đủ lên cấp thì báo cáo đúng cấp trước và sau', async () => {
    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    await fakeProgress(characterId, quest('quest-chao-lang'));
    const outcome = expectCompleteOk(
      await quests.complete(characterId, 'quest-chao-lang', HEADMASTER),
    );

    // 30 kinh nghiệm vừa đúng mốc lên cấp 2, nên phần dư bằng 0.
    expect(outcome.levelBefore).toBe(1);
    expect(outcome.level).toBe(2);
    expect(outcome.levelsGained).toBe(1);
    expect(await readLevelAndExp(characterId)).toEqual({ level: 2, exp: 0 });
  });

  it('túi đầy thì nhiệm vụ vẫn trả xong, món không cất được nằm trong lostItems', async () => {
    const hero = await makeCharacter({ level: 3, yen: 200 });
    await markCompleted(hero, ['quest-chao-lang', 'quest-duong-toi-bai-tap']);
    // 40 ô túi đều là hàng chưa mặc, nên quà không còn chỗ cất.
    await fillBag(hero, INVENTORY_CAPACITY);
    expectAcceptOk(await quests.accept(hero, 'quest-bai-hoc-dau-tien', HEADMASTER, VILLAGE));
    await fakeProgress(hero, quest('quest-bai-hoc-dau-tien'));

    const outcome = expectCompleteOk(
      await quests.complete(hero, 'quest-bai-hoc-dau-tien', HEADMASTER),
    );
    expect(outcome.lostItems).toEqual([
      { itemId: 'item-banh-bao', name: 'Bánh Bao Hấp', quantity: 1 },
    ]);
    expect(outcome.items).toEqual([]);
    expect(await readItemRow(hero, 'item-banh-bao')).toBeUndefined();
    expect(
      (await questRows(hero)).find((row) => row.questId === 'quest-bai-hoc-dau-tien')?.status,
    ).toBe('completed');
    // Kinh nghiệm và yên vẫn được cộng dù món quà bị mất; 60 kinh nghiệm chưa đủ mốc lên cấp 4 (132).
    expect(await readYen(hero)).toBe(200 + 80);
    expect(await readLevelAndExp(hero)).toEqual({ level: 3, exp: 60 });
  });

  it('nhiệm vụ không có unlocks thì không ghi cờ tính năng nào', async () => {
    await markCompleted(characterId, [
      'quest-chao-lang',
      'quest-duong-toi-bai-tap',
      'quest-bai-hoc-dau-tien',
    ]);
    await topUpItem(characterId, 'item-da-vun', 2);
    expectAcceptOk(await quests.accept(characterId, 'quest-nhat-da-vun', TEACHER, VILLAGE));
    await fakeProgress(characterId, quest('quest-nhat-da-vun'));
    expectCompleteOk(await quests.complete(characterId, 'quest-nhat-da-vun', TEACHER));

    expect(await featureRows(characterId)).toEqual([]);
    expect((await quests.state(characterId)).unlockedFeatures).toEqual([]);
    expect((await questRows(characterId)).length).toBe(4);
  });
});

describe('QuestService — offersFor', () => {
  it('người giao chỉ trả nhiệm vụ người chơi nhận được ngay', async () => {
    const offers = await quests.offersFor(characterId, HEADMASTER);
    expect(offers.map((offer) => offer.questId)).toEqual(['quest-chao-lang']);
    expect(offers[0]?.state).toBe('available');
    expect(offers[0]?.giverName).toBe('Thầy Hiệu Trưởng');
    expect(offers[0]?.objectives.map((objective) => objective.progress)).toEqual([0]);
    // Thầy Đồ chưa giao gì cho nhân vật mới: nhiệm vụ của thầy còn khoá ở nhiệm vụ trước.
    expect(await quests.offersFor(characterId, TEACHER)).toEqual([]);
  });

  it('đang giữ nhiệm vụ thì NPC nhận trả trả về nhiệm vụ đó kèm trạng thái thật', async () => {
    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    const active = await quests.offersFor(characterId, HEADMASTER);
    expect(active.map((offer) => offer.questId)).toEqual(['quest-chao-lang']);
    expect(active[0]?.state).toBe('active');

    await quests.progressTalk(characterId, TEACHER);
    const ready = await quests.offersFor(characterId, HEADMASTER);
    expect(ready[0]?.state).toBe('ready');
    expect(ready[0]?.objectives[0]?.done).toBe(true);
  });

  it('trả xong nhiệm vụ đầu thì nhiệm vụ kế tiếp hiện ra ngay ở cùng NPC', async () => {
    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    await fakeProgress(characterId, quest('quest-chao-lang'));
    expectCompleteOk(await quests.complete(characterId, 'quest-chao-lang', HEADMASTER));

    const offers = await quests.offersFor(characterId, HEADMASTER);
    expect(offers.map((offer) => offer.questId)).toEqual(['quest-duong-toi-bai-tap']);
    expect(offers[0]?.state).toBe('available');
  });
});

describe('QuestService — trạng thái cho cây hội thoại', () => {
  it('nhiệm vụ chưa mở không có trạng thái, xong mục tiêu là ready, trả xong là completed', async () => {
    const states = await quests.dialogStates(characterId);
    expect(states.get('quest-chao-lang')).toBe('available');
    expect(states.get('quest-bai-hoc-dau-tien')).toBeUndefined();

    expectAcceptOk(await quests.accept(characterId, 'quest-chao-lang', HEADMASTER, VILLAGE));
    expect((await quests.dialogStates(characterId)).get('quest-chao-lang')).toBe('active');
    await quests.progressTalk(characterId, TEACHER);
    expect((await quests.dialogStates(characterId)).get('quest-chao-lang')).toBe('ready');
    expectCompleteOk(await quests.complete(characterId, 'quest-chao-lang', HEADMASTER));
    expect((await quests.dialogStates(characterId)).get('quest-chao-lang')).toBe('completed');
  });

  it('nhiệm vụ đã trả luôn hiện mục tiêu đã xong, kể cả mục tiêu collect đã tiêu món', async () => {
    await markCompleted(characterId, [
      'quest-chao-lang',
      'quest-duong-toi-bai-tap',
      'quest-bai-hoc-dau-tien',
    ]);
    await topUpItem(characterId, 'item-da-vun', 2);
    expectAcceptOk(await quests.accept(characterId, 'quest-nhat-da-vun', TEACHER, VILLAGE));
    expectCompleteOk(await quests.complete(characterId, 'quest-nhat-da-vun', TEACHER));

    // Tiêu hết đá vụn sau khi trả: nhiệm vụ đã trả vẫn hiện mục tiêu đã xong, không hiện "0/2".
    await (
      await getTestDb()
    )
      .delete(inventoryItems)
      .where(eq(inventoryItems.characterId, characterId));
    const view = await quests.view(characterId, 'quest-nhat-da-vun');
    const objective = view?.objectives[0];
    expect(view?.state).toBe('completed');
    expect(objective?.progress).toBe(objective?.count);
    expect(objective?.done).toBe(true);
  });
});

/** Cởi món khỏi ô đang mặc, chỉ để test kiểm luật "túi chỉ gồm hàng `equipped_slot is null`". */
async function unequip(id: string, itemId: string): Promise<void> {
  await (
    await getTestDb()
  )
    .update(inventoryItems)
    .set({ equippedSlot: null })
    .where(and(eq(inventoryItems.characterId, id), eq(inventoryItems.itemId, itemId)));
}

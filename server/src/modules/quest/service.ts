import { and, asc, eq, sql } from 'drizzle-orm';
import {
  ErrorCode,
  MAX_ACTIVE_QUESTS,
  applyExpGain,
  type Quest,
  type QuestAvailable,
  type QuestObjective,
  type QuestObjectiveView,
  type QuestRewardView,
  type QuestUpdate,
  type QuestView,
  type QuestViewState,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characterFeatures, characterQuests, type CharacterQuestRow } from '../../db/schema.js';
import type { GameData } from '../../world/game-data.js';
import type { CharacterService } from '../character/service.js';
import type { InventoryService } from '../inventory/service.js';

/** Một món quà đã cất vào túi, đủ tên hiển thị cho `S2C_NOTIFY`/client. */
export interface GrantedQuestItem {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
}

/** Một món quà không cất được vì túi đầy — người gọi gửi `S2C_NOTIFY` cho người chơi biết là mất. */
export interface LostQuestItem {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
}

export type QuestAcceptOutcome =
  | { readonly ok: true; readonly questId: string; readonly name: string; readonly message: string }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

export type QuestCompleteOutcome =
  | {
      readonly ok: true;
      readonly questId: string;
      readonly name: string;
      readonly exp: number;
      readonly yen: number;
      readonly items: readonly GrantedQuestItem[];
      /** Cấp trước khi cộng thưởng — để gửi `S2C_LEVEL_UP` kèm đúng chiêu mới học. */
      readonly levelBefore: number;
      readonly level: number;
      readonly levelsGained: number;
      readonly lostItems: readonly LostQuestItem[];
      readonly message: string;
    }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * Nhiệm vụ chính tuyến: nhận ở người giao, trả ở người nhận trả, tiến độ đếm theo sự kiện trong
 * thế giới (`talk`/`kill`/`reach`) hoặc theo túi đồ (`collect`).
 *
 * Hai điểm luật đáng nhớ:
 * - Mục tiêu `collect` đếm món **đang có trong túi** (`equipped_slot is null`) và **không tiêu** món
 *   khi trả nhiệm vụ: món đang mặc không tính, món nhặt được vẫn còn nguyên sau khi trả.
 * - Tiến độ `reach` cộng ngay khi **nhận** nhiệm vụ nếu người chơi đang đứng ở bản đồ đích, nên
 *   nhận xong là xong mục tiêu, không phải đi vòng về rồi quay lại.
 */
export class QuestService {
  constructor(
    private readonly db: Db,
    private readonly gameData: GameData,
    private readonly characters: CharacterService,
    private readonly inventory: InventoryService,
  ) {}

  /** Toàn bộ trạng thái nhiệm vụ của nhân vật — nội dung của `S2C_QUEST_UPDATE`. */
  async state(characterId: string): Promise<QuestUpdate> {
    const rows = await this.rows(characterId);
    const bag = await this.bagCounts(characterId);
    const level = await this.levelOf(characterId);
    const known = rows.filter((row) => this.gameData.quests.has(row.questId));

    const active = known
      .filter((row) => row.status === 'active')
      .sort((left, right) => left.acceptedAt.getTime() - right.acceptedAt.getTime())
      .map((row) => this.viewOf(row, bag));

    const completed = known
      .filter((row) => row.status === 'completed')
      .sort((left, right) => completedAt(left) - completedAt(right));
    const completedIds = new Set(
      known.filter((row) => row.status === 'completed').map((r) => r.questId),
    );

    const available = [...this.gameData.quests.values()]
      .filter(
        (quest) =>
          this.isUnlocked(quest, completedIds, level) &&
          !known.some((row) => row.questId === quest.id),
      )
      .sort(compareQuests)
      .map((quest) => this.availableOf(quest));

    const features = await this.db
      .select({ feature: characterFeatures.feature })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, characterId))
      .orderBy(asc(characterFeatures.unlockedAt), asc(characterFeatures.feature));

    return {
      active,
      available,
      completed: completed.map((row) => row.questId),
      unlockedFeatures: features.map((row) => row.feature),
      maxActive: MAX_ACTIVE_QUESTS,
    };
  }

  /**
   * Trạng thái của **mọi** nhiệm vụ có thật, dùng cho cây hội thoại: nhiệm vụ chưa mở (thiếu cấp
   * hay thiếu nhiệm vụ trước) không có mặt trong map — NPC không nhắc tới thứ người chơi chưa biết.
   */
  async dialogStates(characterId: string): Promise<Map<string, QuestViewState>> {
    const rows = await this.rows(characterId);
    const bag = await this.bagCounts(characterId);
    const level = await this.levelOf(characterId);
    const completedIds = new Set(
      rows.filter((row) => row.status === 'completed').map((row) => row.questId),
    );
    const byQuest = new Map(rows.map((row) => [row.questId, row]));

    const states = new Map<string, QuestViewState>();
    for (const quest of this.gameData.quests.values()) {
      const row = byQuest.get(quest.id);
      if (row !== undefined) {
        states.set(quest.id, this.stateOf(row, bag));
      } else if (this.isUnlocked(quest, completedIds, level)) {
        states.set(quest.id, 'available');
      }
    }
    return states;
  }

  /** Góc nhìn của một nhiệm vụ bất kỳ (đang làm, đã trả hay chưa nhận); không có thì `undefined`. */
  async view(characterId: string, questId: string): Promise<QuestView | undefined> {
    const quest = this.gameData.quests.get(questId);
    if (quest === undefined) {
      return undefined;
    }
    const row = (await this.rows(characterId)).find((candidate) => candidate.questId === questId);
    if (row !== undefined) {
      return this.viewOf(row, await this.bagCounts(characterId));
    }
    const level = await this.levelOf(characterId);
    const completedIds = new Set(await this.completedIds(characterId));
    if (!this.isUnlocked(quest, completedIds, level)) {
      return undefined;
    }
    return this.viewOfQuest(quest, 'available', zeroProgress(quest));
  }

  /**
   * Nhiệm vụ làm được **ngay** tại NPC này: nhận ở người giao (chưa nhận, đủ điều kiện) và trả ở
   * người nhận trả (đang làm, kể cả đã xong mục tiêu chờ trả).
   *
   * Việc trả xếp trước việc nhận: người chơi đang giữ nhiệm vụ cần thấy ngay là trả được, còn nhiệm
   * vụ mới thì lúc nào bấm cũng được.
   */
  async offersFor(characterId: string, npcId: string): Promise<QuestView[]> {
    const rows = await this.rows(characterId);
    const bag = await this.bagCounts(characterId);
    const level = await this.levelOf(characterId);
    const known = rows.filter((row) => this.gameData.quests.has(row.questId));
    const completedIds = new Set(
      known.filter((row) => row.status === 'completed').map((row) => row.questId),
    );

    const turnIns = known
      .filter(
        (row) =>
          row.status === 'active' && this.gameData.quests.get(row.questId)?.turnInNpcId === npcId,
      )
      .sort((left, right) => left.acceptedAt.getTime() - right.acceptedAt.getTime())
      .map((row) => this.viewOf(row, bag));

    const offers = [...this.gameData.quests.values()]
      .filter(
        (quest) =>
          quest.giverNpcId === npcId &&
          !known.some((row) => row.questId === quest.id) &&
          this.isUnlocked(quest, completedIds, level),
      )
      .sort(compareQuests)
      .map((quest) => this.viewOfQuest(quest, 'available', zeroProgress(quest)));

    return [...turnIns, ...offers];
  }

  /** Nhận nhiệm vụ từ đúng người giao. Trả về lý do bằng mã lỗi khi không nhận được. */
  async accept(
    characterId: string,
    questId: string,
    npcId: string | undefined,
    currentMapId: string,
  ): Promise<QuestAcceptOutcome> {
    const quest = this.gameData.quests.get(questId);
    if (quest === undefined) {
      return {
        ok: false,
        code: ErrorCode.QUEST_NOT_FOUND,
        message: `không có nhiệm vụ "${questId}"`,
      };
    }
    if (quest.giverNpcId !== npcId) {
      return {
        ok: false,
        code: ErrorCode.QUEST_WRONG_NPC,
        message: `nhiệm vụ "${quest.name}" nhận ở ${this.npcName(quest.giverNpcId)}, hãy nói chuyện với họ trước`,
      };
    }

    const row = (await this.rows(characterId)).find((candidate) => candidate.questId === questId);
    if (row?.status === 'active') {
      return {
        ok: false,
        code: ErrorCode.QUEST_ALREADY_ACTIVE,
        message: `nhiệm vụ "${quest.name}" đang làm rồi`,
      };
    }
    if (row?.status === 'completed') {
      return {
        ok: false,
        code: ErrorCode.QUEST_ALREADY_DONE,
        message: `nhiệm vụ "${quest.name}" đã trả rồi`,
      };
    }

    const level = await this.levelOf(characterId);
    if (level < quest.levelRequired) {
      return {
        ok: false,
        code: ErrorCode.QUEST_LOCKED,
        message: `nhiệm vụ "${quest.name}" cần cấp ${quest.levelRequired}, bạn mới cấp ${level}`,
      };
    }
    const completedIds = new Set(await this.completedIds(characterId));
    const missing = quest.requiresQuests.filter((required) => !completedIds.has(required));
    if (missing.length > 0) {
      const names = missing.map((required) => this.gameData.quests.get(required)?.name ?? required);
      return {
        ok: false,
        code: ErrorCode.QUEST_LOCKED,
        message: `nhiệm vụ "${quest.name}" phải làm xong trước: ${names.join(', ')}`,
      };
    }

    const activeCount = (await this.rows(characterId)).filter(
      (candidate) => candidate.status === 'active',
    ).length;
    if (activeCount >= MAX_ACTIVE_QUESTS) {
      return {
        ok: false,
        code: ErrorCode.QUEST_TOO_MANY,
        message: `đang làm ${activeCount} nhiệm vụ, trần là ${MAX_ACTIVE_QUESTS} — trả bớt rồi hãy nhận thêm`,
      };
    }

    // Đang đứng ngay bản đồ đích thì mục tiêu `reach` xong luôn lúc nhận, không bắt đi vòng quay lại.
    const progress = quest.objectives.map((objective) =>
      objective.kind === 'reach' && objective.targetId === currentMapId
        ? Math.min(1, objective.count)
        : 0,
    );
    const inserted = await this.db
      .insert(characterQuests)
      .values({ characterId, questId, status: 'active', progress })
      .onConflictDoNothing({ target: [characterQuests.characterId, characterQuests.questId] })
      .returning({ id: characterQuests.id });
    if (inserted.length === 0) {
      // Hai gói nhận cùng lúc: câu insert thứ hai không tạo hàng nào.
      return {
        ok: false,
        code: ErrorCode.QUEST_ALREADY_ACTIVE,
        message: `nhiệm vụ "${quest.name}" đang làm rồi`,
      };
    }

    return { ok: true, questId, name: quest.name, message: `Đã nhận nhiệm vụ "${quest.name}"` };
  }

  /**
   * Trả nhiệm vụ ở đúng người nhận trả khi mọi mục tiêu đã xong: cộng kinh nghiệm/yên, cất quà, ghi
   * cờ tính năng. Túi đầy thì nhiệm vụ **vẫn** trả xong; món không cất được coi như mất và nằm trong
   * `lostItems` để người gọi báo cho người chơi.
   */
  async complete(
    characterId: string,
    questId: string,
    npcId: string | undefined,
  ): Promise<QuestCompleteOutcome> {
    const quest = this.gameData.quests.get(questId);
    if (quest === undefined) {
      return {
        ok: false,
        code: ErrorCode.QUEST_NOT_FOUND,
        message: `không có nhiệm vụ "${questId}"`,
      };
    }
    if (quest.turnInNpcId !== npcId) {
      return {
        ok: false,
        code: ErrorCode.QUEST_WRONG_NPC,
        message: `nhiệm vụ "${quest.name}" trả ở ${this.npcName(quest.turnInNpcId)}, không phải ở đây`,
      };
    }

    const row = (await this.rows(characterId)).find((candidate) => candidate.questId === questId);
    if (row === undefined) {
      return {
        ok: false,
        code: ErrorCode.QUEST_NOT_READY,
        message: `bạn chưa nhận nhiệm vụ "${quest.name}"`,
      };
    }
    if (row.status === 'completed') {
      return {
        ok: false,
        code: ErrorCode.QUEST_ALREADY_DONE,
        message: `nhiệm vụ "${quest.name}" đã trả rồi`,
      };
    }

    const bag = await this.bagCounts(characterId);
    const objectives = this.objectivesOf(quest, row.progress, bag);
    const undone = objectives.filter((objective) => !objective.done);
    if (undone.length > 0) {
      const detail = undone
        .map((objective) => `${objective.description} (${objective.progress}/${objective.count})`)
        .join(', ');
      return {
        ok: false,
        code: ErrorCode.QUEST_NOT_READY,
        message: `nhiệm vụ "${quest.name}" chưa xong: ${detail}`,
      };
    }

    const record = await this.characters.findById(characterId);
    if (record === undefined) {
      throw new Error(`không tìm thấy nhân vật ${characterId} khi trả nhiệm vụ ${questId}`);
    }

    const gain = applyExpGain(record.level, record.exp, quest.rewards.exp);
    await this.characters.updateProgress(characterId, {
      level: gain.level,
      exp: gain.exp,
      yen: record.yen + quest.rewards.yen,
    });

    const lostItems: LostQuestItem[] = [];
    const granted: GrantedQuestItem[] = [];
    for (const item of quest.rewards.items) {
      const name = this.itemName(item.itemId);
      const stored = await this.inventory.grant(characterId, item.itemId, item.quantity);
      if (stored !== 'ok') {
        lostItems.push({ itemId: item.itemId, name, quantity: item.quantity });
      } else {
        granted.push({ itemId: item.itemId, name, quantity: item.quantity });
      }
    }

    if (quest.unlocks.length > 0) {
      await this.db
        .insert(characterFeatures)
        .values(quest.unlocks.map((feature) => ({ characterId, feature })))
        .onConflictDoNothing({
          target: [characterFeatures.characterId, characterFeatures.feature],
        });
    }

    await this.db
      .update(characterQuests)
      .set({ status: 'completed', completedAt: sql`now()` })
      .where(eq(characterQuests.id, row.id));

    return {
      ok: true,
      questId,
      name: quest.name,
      exp: quest.rewards.exp,
      yen: quest.rewards.yen,
      items: granted,
      levelBefore: record.level,
      level: gain.level,
      levelsGained: gain.levelsGained,
      lostItems,
      message: rewardMessage(quest.name, quest.rewards, (itemId) => this.itemName(itemId)),
    };
  }

  /** Nói chuyện với NPC: cộng tiến độ cho mọi nhiệm vụ đang làm có mục tiêu `talk` nhắm NPC đó. */
  progressTalk(characterId: string, npcId: string): Promise<boolean> {
    return this.progress(characterId, 'talk', (objective) => objective.targetId === npcId);
  }

  /** Hạ một con quái: cộng tiến độ cho mọi nhiệm vụ đang làm nhắm đúng loại quái đó. */
  progressKill(characterId: string, monsterId: string): Promise<boolean> {
    return this.progress(characterId, 'kill', (objective) => objective.targetId === monsterId);
  }

  /** Đặt chân tới bản đồ: cộng tiến độ cho mọi nhiệm vụ đang làm nhắm đúng bản đồ đó. */
  progressReach(characterId: string, mapId: string): Promise<boolean> {
    return this.progress(characterId, 'reach', (objective) => objective.targetId === mapId);
  }

  /** Cờ tính năng đã mở khóa bằng nhiệm vụ (nhóm, Lôi Đài…). */
  async hasFeature(characterId: string, feature: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: characterFeatures.id })
      .from(characterFeatures)
      .where(
        and(eq(characterFeatures.characterId, characterId), eq(characterFeatures.feature, feature)),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Cộng một điểm tiến độ cho mọi mục tiêu khớp; trả `true` nếu có hàng nào đổi. */
  private async progress(
    characterId: string,
    kind: QuestObjective['kind'],
    matches: (objective: QuestObjective) => boolean,
  ): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(characterQuests)
      .where(
        and(eq(characterQuests.characterId, characterId), eq(characterQuests.status, 'active')),
      );

    let changed = false;
    for (const row of rows) {
      const quest = this.gameData.quests.get(row.questId);
      if (quest === undefined) {
        continue;
      }
      const values = normalizedProgress(quest, row.progress);
      let touched = false;
      quest.objectives.forEach((objective, index) => {
        if (objective.kind !== kind || !matches(objective) || values[index] >= objective.count) {
          return;
        }
        values[index] += 1;
        touched = true;
      });
      if (touched) {
        await this.db
          .update(characterQuests)
          .set({ progress: values })
          .where(eq(characterQuests.id, row.id));
        changed = true;
      }
    }
    return changed;
  }

  private rows(characterId: string): Promise<CharacterQuestRow[]> {
    return this.db
      .select()
      .from(characterQuests)
      .where(eq(characterQuests.characterId, characterId));
  }

  private async completedIds(characterId: string): Promise<string[]> {
    const rows = await this.db
      .select({ questId: characterQuests.questId })
      .from(characterQuests)
      .where(
        and(eq(characterQuests.characterId, characterId), eq(characterQuests.status, 'completed')),
      );
    return rows.map((row) => row.questId);
  }

  private async levelOf(characterId: string): Promise<number> {
    return (await this.characters.findById(characterId))?.level ?? 1;
  }

  /**
   * Số món mỗi loại **đang có trong túi** (hàng `equipped_slot is null`); món đang mặc không tính,
   * vì mục tiêu `collect` nói về đồ mang theo chứ không phải đồ trên người.
   */
  private async bagCounts(characterId: string): Promise<Map<string, number>> {
    const rows = await this.inventory.list(characterId);
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + row.quantity);
    }
    return counts;
  }

  /** Nhiệm vụ chưa nhận chỉ hiện khi đã đủ cấp **và** xong hết nhiệm vụ trước. */
  private isUnlocked(quest: Quest, completedIds: ReadonlySet<string>, level: number): boolean {
    return (
      level >= quest.levelRequired &&
      quest.requiresQuests.every((required) => completedIds.has(required))
    );
  }

  private stateOf(row: CharacterQuestRow, bag: ReadonlyMap<string, number>): QuestViewState {
    if (row.status === 'completed') {
      return 'completed';
    }
    const quest = this.gameData.quests.get(row.questId);
    if (quest === undefined) {
      return 'active';
    }
    return this.objectivesOf(quest, row.progress, bag).every((objective) => objective.done)
      ? 'ready'
      : 'active';
  }

  private viewOf(row: CharacterQuestRow, bag: ReadonlyMap<string, number>): QuestView {
    const quest = this.gameData.quests.get(row.questId);
    if (quest === undefined) {
      throw new Error(
        `nhiệm vụ ${row.questId} đang có trong database nhưng không có trong game-data`,
      );
    }
    const objectives =
      row.status === 'completed'
        ? completedObjectives(quest)
        : this.objectivesOf(quest, row.progress, bag);
    const state: QuestViewState =
      row.status === 'completed'
        ? 'completed'
        : objectives.every((objective) => objective.done)
          ? 'ready'
          : 'active';
    return this.viewOfQuest(quest, state, objectives);
  }

  private viewOfQuest(
    quest: Quest,
    state: QuestViewState,
    objectives: readonly QuestObjectiveView[],
  ): QuestView {
    return {
      questId: quest.id,
      name: quest.name,
      summary: quest.summary,
      chapter: quest.chapter,
      state,
      giverNpcId: quest.giverNpcId,
      giverName: this.npcName(quest.giverNpcId),
      turnInNpcId: quest.turnInNpcId,
      turnInName: this.npcName(quest.turnInNpcId),
      levelRequired: quest.levelRequired,
      objectives: [...objectives],
      rewards: this.rewardViewOf(quest),
      unlocks: [...quest.unlocks],
    };
  }

  /**
   * Tiến độ từng mục tiêu: `talk`/`kill`/`reach` lấy từ `progress` đã lưu, `collect` đếm lại từ túi
   * mỗi lần gọi — nhặt thêm hay tiêu bớt món thì con số phải đổi ngay. Số đếm luôn bị kẹp trong
   * `[0, count]`.
   */
  private objectivesOf(
    quest: Quest,
    stored: readonly number[],
    bag: ReadonlyMap<string, number>,
  ): QuestObjectiveView[] {
    const values = normalizedProgress(quest, stored);
    return quest.objectives.map((objective, index) => {
      const raw = objective.kind === 'collect' ? (bag.get(objective.targetId) ?? 0) : values[index];
      const progress = Math.max(0, Math.min(objective.count, Math.trunc(raw)));
      return {
        kind: objective.kind,
        targetId: objective.targetId,
        description: objective.description,
        count: objective.count,
        progress,
        done: progress >= objective.count,
      };
    });
  }

  private rewardViewOf(quest: Quest): QuestRewardView {
    return {
      exp: quest.rewards.exp,
      yen: quest.rewards.yen,
      items: quest.rewards.items.map((item) => ({
        itemId: item.itemId,
        name: this.itemName(item.itemId),
        quantity: item.quantity,
      })),
    };
  }

  private availableOf(quest: Quest): QuestAvailable {
    return {
      questId: quest.id,
      name: quest.name,
      giverNpcId: quest.giverNpcId,
      giverName: this.npcName(quest.giverNpcId),
      turnInNpcId: quest.turnInNpcId,
      turnInName: this.npcName(quest.turnInNpcId),
      levelRequired: quest.levelRequired,
    };
  }

  private npcName(npcId: string): string {
    return this.gameData.npcs.get(npcId)?.name ?? npcId;
  }

  private itemName(itemId: string): string {
    return this.gameData.items.get(itemId)?.name ?? itemId;
  }
}

/** Nhãn cấp: nhiệm vụ trước theo `chapter` rồi theo id, để danh sách không đổi thứ tự giữa các lần. */
function compareQuests(left: Quest, right: Quest): number {
  return left.chapter - right.chapter || left.id.localeCompare(right.id);
}

function completedAt(row: CharacterQuestRow): number {
  return row.completedAt?.getTime() ?? 0;
}

/** Tiến độ đã lưu có thể cũ hơn file nhiệm vụ (sửa dữ liệu giữa chừng) nên luôn chuẩn hóa lại độ dài. */
function normalizedProgress(quest: Quest, stored: readonly number[]): number[] {
  return quest.objectives.map((_, index) => {
    const value = stored[index] ?? 0;
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  });
}

/**
 * Nhiệm vụ **đã trả** thì mọi mục tiêu coi như xong: mục tiêu `collect` đếm từ túi nên nếu người chơi
 * tiêu món sau khi trả, nhiệm vụ đã hoàn thành sẽ hiện "0/2" — vô lý với một nhiệm vụ đã xong.
 */
function completedObjectives(quest: Quest): QuestObjectiveView[] {
  return quest.objectives.map((objective) => ({
    kind: objective.kind,
    targetId: objective.targetId,
    description: objective.description,
    count: objective.count,
    progress: objective.count,
    done: true,
  }));
}

function zeroProgress(quest: Quest): QuestObjectiveView[] {
  return quest.objectives.map((objective) => ({
    kind: objective.kind,
    targetId: objective.targetId,
    description: objective.description,
    count: objective.count,
    progress: 0,
    done: false,
  }));
}

/** Câu thưởng cho `S2C_NOTIFY`: chỉ kể phần thực sự có, để không hiện "+0 kinh nghiệm". */
function rewardMessage(
  questName: string,
  rewards: Quest['rewards'],
  itemName: (itemId: string) => string,
): string {
  const parts: string[] = [];
  if (rewards.exp > 0) {
    parts.push(`+${rewards.exp} kinh nghiệm`);
  }
  if (rewards.yen > 0) {
    parts.push(`+${rewards.yen} yên`);
  }
  for (const item of rewards.items) {
    parts.push(`${item.quantity}× ${itemName(item.itemId)}`);
  }
  return `Đã trả nhiệm vụ "${questName}"${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`;
}

/** Câu báo món quà bị mất vì túi đầy — WorldService gửi kèm `S2C_NOTIFY` sau câu thưởng. */
export function lostItemsMessage(items: readonly LostQuestItem[]): string {
  const parts = items.map((item) => `${item.quantity}× ${item.name}`);
  return `Túi đã đầy nên ${parts.join(', ')} bị mất — dọn túi rồi quay lại nhận`;
}

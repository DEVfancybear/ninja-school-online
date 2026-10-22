import { and, eq, sql } from 'drizzle-orm';
import {
  ErrorCode,
  FIELD_BOSS_DAILY_LOOT,
  FIELD_BOSS_ID,
  FIELD_BOSS_MAP_ID,
  DEFAULT_FIELD_BOSS_SCHEDULE,
  M7_EVENT_ENABLED,
  M7_EVENT_ID,
  M7_EVENT_QUEST_ID,
  M7_EVENT_QUEST_KILL_TARGET,
  M7_LOGIN_REWARD,
  M7_QUEST_REWARD,
  Opcode,
  fieldBossWindow,
  m7UtcDay,
  type FieldBossSchedule,
  type M7State,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { bossLootClaims, characters, eventLoginClaims, eventQuests, mails } from '../../db/schema.js';
import type { SessionRegistry } from '../../net/session-registry.js';
import type { InventoryService } from '../inventory/service.js';
import type { MailService } from '../mail/service.js';
import type { GameData } from '../../world/game-data.js';

export type M7Result =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };
export type BossLootResult = 'granted' | 'capped' | 'inventory_full' | 'unknown_item';

export interface M7ServiceOptions {
  readonly eventEnabled?: boolean;
  readonly fieldBossSchedule?: FieldBossSchedule;
  readonly now?: () => number;
}

const EVENT_QUEST_MAIL_KEY = 'm7-quest-first-monster';
const fail = (code: ErrorCode, message: string): M7Result => ({ ok: false, code, message });

class InventoryRollback extends Error {
  constructor(readonly reason: 'inventory_full' | 'unknown_item') { super(reason); }
}

/** First event claims and field-boss loot are persisted; all progress comes from server combat settlement. */
export class M7Service {
  private readonly now: () => number;
  private readonly eventEnabled: boolean;
  private readonly fieldBossSchedule: FieldBossSchedule;

  constructor(
    private readonly db: Db,
    private readonly inventory: InventoryService,
    private readonly sessions: SessionRegistry,
    private readonly gameData: GameData,
    private readonly mail: MailService,
    options: M7ServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.eventEnabled = options.eventEnabled ?? M7_EVENT_ENABLED;
    this.fieldBossSchedule = options.fieldBossSchedule ?? DEFAULT_FIELD_BOSS_SCHEDULE;
  }

  async state(characterId: string): Promise<M7State> {
    const now = this.now();
    const utcDay = m7UtcDay(now);
    const [loginClaim] = await this.db
      .select({ characterId: eventLoginClaims.characterId })
      .from(eventLoginClaims)
      .where(and(
        eq(eventLoginClaims.characterId, characterId),
        eq(eventLoginClaims.eventId, M7_EVENT_ID),
        eq(eventLoginClaims.utcDay, utcDay),
      ))
      .limit(1);
    const [quest] = await this.db
      .select()
      .from(eventQuests)
      .where(and(
        eq(eventQuests.characterId, characterId),
        eq(eventQuests.eventId, M7_EVENT_ID),
        eq(eventQuests.questId, M7_EVENT_QUEST_ID),
      ))
      .limit(1);
    const [bossClaim] = await this.db
      .select({ characterId: bossLootClaims.characterId })
      .from(bossLootClaims)
      .where(and(
        eq(bossLootClaims.characterId, characterId),
        eq(bossLootClaims.bossId, FIELD_BOSS_ID),
        eq(bossLootClaims.utcDay, utcDay),
      ))
      .limit(1);
    const window = fieldBossWindow(now, this.fieldBossSchedule);
    return {
      event: {
        id: M7_EVENT_ID,
        enabled: this.eventEnabled,
        utcDay,
        loginClaimed: loginClaim !== undefined,
        loginReward: { yen: M7_LOGIN_REWARD.yen, items: [...M7_LOGIN_REWARD.items] },
        quest: {
          id: M7_EVENT_QUEST_ID,
          name: 'Thử thách đầu tiên',
          description: 'Đánh bại 1 quái trong thế giới. Tiến độ chỉ được ghi nhận từ kết quả trận trên máy chủ.',
          progress: Math.min(quest?.progress ?? 0, M7_EVENT_QUEST_KILL_TARGET),
          target: M7_EVENT_QUEST_KILL_TARGET,
          complete: quest?.completedAt !== null && quest?.completedAt !== undefined,
          rewarded: quest?.rewardedAt !== null && quest?.rewardedAt !== undefined,
          reward: { yen: M7_QUEST_REWARD.yen, items: [...M7_QUEST_REWARD.items] },
        },
      },
      boss: {
        id: FIELD_BOSS_ID,
        mapId: FIELD_BOSS_MAP_ID,
        name: this.gameData.monsters.get(FIELD_BOSS_ID)?.name ?? 'Thú Vương',
        active: window.active,
        windowStartsAt: window.startsAt,
        windowEndsAt: window.endsAt,
        dailyLootClaimed: bossClaim !== undefined,
        lootItemId: FIELD_BOSS_DAILY_LOOT.itemId,
        lootQty: FIELD_BOSS_DAILY_LOOT.qty,
      },
    };
  }

  /** Daily claim transaction: unique UTC-day claim and mail insert commit or roll back together. */
  async claimLogin(characterId: string): Promise<M7Result> {
    if (!this.eventEnabled) return fail(ErrorCode.EVENT_DISABLED, 'event đầu tiên hiện chưa mở');
    const utcDay = m7UtcDay(this.now());
    const result = await this.db.transaction(async (tx) => {
      const [claim] = await tx
        .insert(eventLoginClaims)
        .values({ characterId, eventId: M7_EVENT_ID, utcDay })
        .onConflictDoNothing({ target: [eventLoginClaims.characterId, eventLoginClaims.eventId, eventLoginClaims.utcDay] })
        .returning({ characterId: eventLoginClaims.characterId });
      if (!claim) return false;
      await tx.insert(mails).values({
        characterId,
        mailKey: `m7-login-${utcDay}`,
        subject: 'Quà đăng nhập sự kiện',
        body: `Phần thưởng đăng nhập ngày ${utcDay} (UTC).`,
        yen: M7_LOGIN_REWARD.yen,
        items: M7_LOGIN_REWARD.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
      }).onConflictDoNothing({ target: [mails.characterId, mails.mailKey] });
      return true;
    });
    if (!result) return fail(ErrorCode.EVENT_ALREADY_CLAIMED, 'bạn đã nhận quà đăng nhập event hôm nay (UTC) rồi');
    const session = this.sessions.get(characterId);
    if (session) {
      session.send(Opcode.S2C_MAILS, await this.mail.list(characterId));
      session.send(Opcode.S2C_M7_STATE, await this.state(characterId));
    }
    return { ok: true };
  }

  /** Called only after a server-resolved PvE victory; one kill completes the immutable first quest. */
  async onMonsterKilled(characterId: string): Promise<void> {
    if (!this.eventEnabled) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(eventQuests).values({
        characterId,
        eventId: M7_EVENT_ID,
        questId: M7_EVENT_QUEST_ID,
        progress: 0,
      }).onConflictDoNothing({ target: [eventQuests.characterId, eventQuests.eventId, eventQuests.questId] });
      const [quest] = await tx.select().from(eventQuests).where(and(
        eq(eventQuests.characterId, characterId),
        eq(eventQuests.eventId, M7_EVENT_ID),
        eq(eventQuests.questId, M7_EVENT_QUEST_ID),
      )).for('update').limit(1);
      if (!quest || quest.completedAt !== null) return;
      const nextProgress = Math.min(quest.progress + 1, M7_EVENT_QUEST_KILL_TARGET);
      const complete = nextProgress >= M7_EVENT_QUEST_KILL_TARGET;
      await tx.update(eventQuests).set({
        progress: nextProgress,
        ...(complete ? { completedAt: sql`now()` } : {}),
      }).where(and(
        eq(eventQuests.characterId, characterId),
        eq(eventQuests.eventId, M7_EVENT_ID),
        eq(eventQuests.questId, M7_EVENT_QUEST_ID),
      ));
      if (complete && quest.rewardedAt === null) {
        await tx.insert(mails).values({
          characterId,
          mailKey: EVENT_QUEST_MAIL_KEY,
          subject: 'Thưởng thử thách sự kiện',
          body: 'Bạn đã hoàn thành thử thách đầu tiên. Nhận phần thưởng trong hộp thư.',
          yen: M7_QUEST_REWARD.yen,
          items: M7_QUEST_REWARD.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
        }).onConflictDoNothing({ target: [mails.characterId, mails.mailKey] });
        await tx.update(eventQuests).set({ rewardedAt: sql`now()` }).where(and(
          eq(eventQuests.characterId, characterId),
          eq(eventQuests.eventId, M7_EVENT_ID),
          eq(eventQuests.questId, M7_EVENT_QUEST_ID),
          sql`${eventQuests.rewardedAt} is null`,
        ));
      }
    });
    const session = this.sessions.get(characterId);
    if (session) {
      session.send(Opcode.S2C_M7_STATE, await this.state(characterId));
      session.send(Opcode.S2C_MAILS, await this.mail.list(characterId));
    }
  }

  /**
   * The unique claim and inventory grant share one transaction, locked on the character row. A full
   * inventory rolls back the claim so the player can retry after making space; no read-then-write cap.
   */
  async grantBossLoot(characterId: string): Promise<BossLootResult> {
    const utcDay = m7UtcDay(this.now());
    let result: BossLootResult;
    try {
      result = await this.db.transaction(async (tx) => {
        await tx.select({ id: characters.id }).from(characters).where(eq(characters.id, characterId)).for('update');
        const [claim] = await tx.insert(bossLootClaims).values({
          characterId,
          bossId: FIELD_BOSS_ID,
          utcDay,
        }).onConflictDoNothing({ target: [bossLootClaims.characterId, bossLootClaims.bossId, bossLootClaims.utcDay] })
          .returning({ id: bossLootClaims.id });
        if (!claim) return 'capped';
        const grant = await this.inventory.grantItems(characterId, [FIELD_BOSS_DAILY_LOOT], tx);
        if (grant !== 'ok') throw new InventoryRollback(grant);
        return 'granted';
      });
    } catch (error) {
      if (error instanceof InventoryRollback) result = error.reason;
      else throw error;
    }
    const session = this.sessions.get(characterId);
    if (session) session.send(Opcode.S2C_M7_STATE, await this.state(characterId));
    return result;
  }
}

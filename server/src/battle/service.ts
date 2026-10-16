import {
  BATTLE_MAX_PLAYERS,
  BATTLE_TURN_MS,
  DEFEAT_YEN_LOSS_RATIO,
  ErrorCode,
  MONSTER_ENGAGE_RANGE_PX,
  MONSTER_TURN_DELAY_MS,
  Opcode,
  REVIVE_HP_RATIO,
  applyExpGain,
  type BattleAction,
  type BattleEnd,
  type BattleEvent,
  type BattleResult,
  type BattleStart,
  type BattleTurn,
  type Combatant as CombatantPayload,
  type Item,
  type LevelUp,
  type Monster,
  type Skill,
  type StatBlock,
  type UseItem,
} from '@ninja/shared';
import type { TickScheduler } from '../core/tick.js';
import type { RoomManager } from '../core/room-manager.js';
import type { CharacterService } from '../modules/character/service.js';
import {
  NO_STATS_BONUS,
  characterStatsPayload,
  currentHp,
  currentMp,
  resolvedFor,
  skillsOf,
  type CharacterRecord,
} from '../modules/character/stats.js';
import type { EquipmentService } from '../modules/equipment/service.js';
import type { InventoryService } from '../modules/inventory/service.js';
import type { GameSession } from '../net/session.js';
import type { SessionRegistry } from '../net/session-registry.js';
import type { GameData } from '../world/game-data.js';
import type { Room, RoomMonster, RoomPlayer } from '../world/room.js';
import { distance } from '../world/movement.js';
import {
  cooldownUntilRound,
  cooldownTurnsFor,
  fleeChance,
  isAlive,
  normalAttackBase,
  readyInTurns,
  rollHit,
  skillBase,
  turnOrder,
  type Combatant,
  type Rng,
} from './engine.js';

/** Kết quả cuối cùng của một trận, dùng cả cho gói `S2C_BATTLE_END` lẫn việc dọn trận. */
export type BattleOutcome = BattleEnd['outcome'];

/** Một trận đang chạy. Mọi trạng thái đều nằm trong bộ nhớ; database chỉ ghi khi trận kết thúc. */
interface ActiveBattle {
  readonly id: string;
  readonly mapId: string;
  /** Người chơi theo id nhân vật. */
  readonly players: Map<string, Combatant>;
  /** Quái của trận theo id thực thể trong room (M3: một trận một con). */
  readonly monsters: Map<string, Combatant>;
  roundNo: number;
  order: string[];
  orderIndex: number;
  actorId: string | undefined;
  turnEndsAt: number;
  /** Quái "suy nghĩ" tới lúc này rồi mới ra đòn (xem `MONSTER_TURN_DELAY_MS`). */
  actorReadyAt: number;
  over: boolean;
}

export interface BattleServiceOptions {
  gameData: GameData;
  rooms: RoomManager;
  sessions: SessionRegistry;
  characters: CharacterService;
  inventory: InventoryService;
  /** Trang bị đang mặc: chỉ số cộng thêm phải có cả trong ảnh chụp lúc vào trận lẫn khi trả thưởng. */
  equipment: EquipmentService;
  /** Nhịp dùng chung: trận đấu đếm lượt và hết giờ trên cùng nhịp với phần còn lại của server. */
  tick: TickScheduler;
  /**
   * Đưa nhân vật về điểm hồi sinh sau khi thua. `WorldService` cài đặt việc này (đổi room, gửi lại
   * bản đồ) — tầng trận đấu không tự đổi bản đồ.
   */
  onDefeat: (characterId: string) => void;
  now?: () => number;
  rng?: Rng;
  onError?: (error: unknown) => void;
}

export interface EngageRequest {
  readonly session: GameSession;
  readonly room: Room;
  readonly player: RoomPlayer;
  /** Id thực thể của quái mà client vừa chạm. */
  readonly targetId: string;
}

/**
 * Trận đấu theo lượt PvE. Server là bên duy nhất quyết định: thứ tự lượt, sát thương, hồi chiêu,
 * phần thưởng. Client chỉ gửi ý định (`C2S_ATTACK_MOB`, `C2S_BATTLE_ACTION`) và vẽ những gì nhận được.
 *
 * Mọi thao tác đổi trạng thái trận đều đi qua một hàng đợi riêng của trận đó, nên gói tin của người
 * chơi, lượt của quái và việc hết giờ không bao giờ chồng lên nhau.
 */
export class BattleService {
  private readonly battles = new Map<string, ActiveBattle>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly unsubscribe: () => void;
  private sequence = 0;

  constructor(private readonly options: BattleServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.rng = options.rng ?? Math.random;
    this.unsubscribe = options.tick.onTick(() => {
      this.tick();
    });
  }

  /** Số trận đang chạy — dùng cho log và kiểm thử. */
  get activeCount(): number {
    return this.battles.size;
  }

  /** Nhân vật có đang trong trận không (dùng để chặn di chuyển và chặn vào trận thứ hai). */
  isBusy(characterId: string): boolean {
    return this.battleOf(characterId) !== undefined;
  }

  dispose(): void {
    this.unsubscribe();
    this.battles.clear();
  }

  /**
   * `C2S_ATTACK_MOB`: chạm vào một con quái để vào trận. Quái đã có trận thì **vào chung** trận đó
   * (tối đa `BATTLE_MAX_PLAYERS` người), chưa có thì mở trận mới.
   */
  async engage(request: EngageRequest): Promise<void> {
    const { session, room, player, targetId } = request;

    if (this.isBusy(player.id)) {
      session.sendError(ErrorCode.IN_BATTLE, 'bạn đang trong một trận đấu rồi');
      return;
    }

    const monster = room.monsters().find((candidate) => candidate.id === targetId);
    if (!monster || !monster.alive) {
      session.sendError(
        ErrorCode.MONSTER_GONE,
        'không có con quái này ở đây — có thể nó vừa bị hạ, chờ nó sống lại',
      );
      return;
    }

    if (distance(player.x, player.y, monster.x, monster.y) > MONSTER_ENGAGE_RANGE_PX) {
      session.sendError(ErrorCode.OUT_OF_RANGE, 'bạn ở quá xa con quái này, hãy lại gần rồi đánh');
      return;
    }

    const record = await this.options.characters.findById(player.id);
    // Ảnh chụp lúc vào trận phải gồm cả trang bị đang mặc, nếu không thì mặc đồ rồi vào trận vẫn yếu.
    const bonus = record
      ? await this.options.equipment.bonusFor(record.id)
      : NO_STATS_BONUS;
    const combatant = record ? this.playerCombatant(record, bonus) : undefined;
    if (!combatant) {
      session.sendError(ErrorCode.INTERNAL, 'không đọc được nhân vật của bạn, hãy vào lại');
      return;
    }

    const existing = this.battleForMonster(room.map.id, monster.id);
    if (existing) {
      if (existing.players.size >= BATTLE_MAX_PLAYERS) {
        session.sendError(
          ErrorCode.INVALID_TARGET,
          `trận này đã đủ ${BATTLE_MAX_PLAYERS} người, hãy tìm con quái khác`,
        );
        return;
      }
      existing.players.set(combatant.id, combatant);
      // Vào trận thì đứng yên: đang đi mà bị kéo vào trận sẽ khó hiểu.
      player.target = undefined;
      this.broadcast(existing, Opcode.S2C_BATTLE_START, this.startPayload(existing));
      return;
    }

    const battle = this.createBattle(room, monster, combatant);
    player.target = undefined;
    // Mở lượt trước rồi mới phát `S2C_BATTLE_START`: gói bắt đầu trận đã có sẵn người tới lượt.
    this.beginNextTurn(battle, this.now(), false);
    if (!battle.over) {
      this.broadcast(battle, Opcode.S2C_BATTLE_START, this.startPayload(battle));
    }
  }

  /** `C2S_BATTLE_ACTION`: hành động của người đang tới lượt. */
  async action(session: GameSession, request: BattleAction): Promise<void> {
    const characterId = session.characterId;
    if (!characterId) {
      session.sendError(ErrorCode.INTERNAL, 'bạn chưa vào bản đồ nào, hãy bắt tay lại');
      return;
    }
    const battle = this.battles.get(request.battleId);
    if (!battle || !battle.players.has(characterId)) {
      session.sendError(ErrorCode.BATTLE_NOT_FOUND, 'trận này không còn nữa');
      return;
    }
    await this.enqueue(battle, () =>
      this.applyPlayerAction(battle, characterId, request, 'action'),
    );
  }

  /**
   * `C2S_USE_ITEM` ngoài trận. Trong trận thì dùng vật phẩm là **một lượt**, nên phải đi qua
   * `C2S_BATTLE_ACTION` — nếu không người chơi sẽ hồi máu vô hạn mà không mất lượt.
   */
  async useItem(session: GameSession, request: UseItem): Promise<void> {
    const characterId = session.characterId;
    if (!characterId) {
      session.sendError(ErrorCode.INTERNAL, 'bạn chưa vào bản đồ nào, hãy bắt tay lại');
      return;
    }
    if (this.isBusy(characterId)) {
      session.sendError(ErrorCode.IN_BATTLE, 'trong trận, dùng vật phẩm là một lượt của bạn');
      return;
    }

    const item = this.options.gameData.items.get(request.itemId);
    if (!item || item.kind !== 'consumable' || item.consumable === null) {
      session.sendError(ErrorCode.ITEM_NOT_USABLE, 'vật phẩm này không dùng được');
      return;
    }

    const record = await this.options.characters.findById(characterId);
    if (!record) {
      session.sendError(ErrorCode.INTERNAL, 'không đọc được nhân vật của bạn, hãy vào lại');
      return;
    }
    const bonus = await this.options.equipment.bonusFor(characterId);
    const resolved = resolvedFor(this.options.gameData, record, bonus);
    const hp = currentHp(record, resolved.maxHp);
    const mp = currentMp(record, resolved.maxMp);

    const healed = this.applyConsumable(item, hp, resolved.maxHp, mp, resolved.maxMp);
    if (healed.hp === hp && healed.mp === mp) {
      session.sendError(ErrorCode.ITEM_NO_EFFECT, 'chỉ số đang đầy, dùng lúc này thì phí');
      return;
    }

    if (!(await this.options.inventory.take(characterId, item.id, 1))) {
      session.sendError(ErrorCode.ITEM_NOT_OWNED, 'bạn không có vật phẩm này trong túi');
      return;
    }

    await this.options.characters.updateVitals(characterId, healed.hp, healed.mp);
    this.sendCharacter(session, { ...record }, healed.hp, healed.mp, bonus);
    session.send(Opcode.S2C_INVENTORY_UPDATE, await this.options.inventory.toPacket(characterId));
  }

  /**
   * Nhân vật rời thế giới (ngắt kết nối, bị phiên mới đẩy ra, hoặc server đóng). Người chơi biến
   * khỏi trận ngay; quái còn sống thì hồi đầy máu khi trận không còn ai.
   */
  leave(characterId: string): void {
    const battle = this.battleOf(characterId);
    if (!battle) {
      return;
    }
    void this.enqueue(battle, async () => {
      const combatant = battle.players.get(characterId);
      battle.players.delete(characterId);
      if (combatant) {
        // Máu/nội lực đang có phải được ghi lại: nếu không, người chơi ngắt kết nối giữa trận sẽ
        // quay lại với số máu cũ trong database (như được hồi đầy miễn phí).
        await this.options.characters.updateVitals(
          combatant.id,
          this.clamp(combatant.hp, 1, combatant.maxHp),
          this.clamp(combatant.mp, 0, combatant.maxMp),
        );
      }
      if (battle.over) {
        return;
      }
      if (battle.players.size === 0) {
        await this.finish(battle, 'fled');
        return;
      }
      if (battle.actorId === characterId) {
        this.beginNextTurn(battle, this.now());
      }
    });
  }

  /**
   * Chạy theo nhịp chung: quái ra đòn sau `MONSTER_TURN_DELAY_MS`, người chơi hết `BATTLE_TURN_MS`
   * thì tự đánh thường (trận không bao giờ treo vì một người bỏ đi uống nước).
   */
  tick(): void {
    const now = this.now();
    for (const battle of [...this.battles.values()]) {
      if (battle.over || !battle.actorId) {
        continue;
      }
      const actor = this.findCombatant(battle, battle.actorId);
      if (!actor || !isAlive(actor)) {
        void this.enqueue(battle, async () => {
          this.beginNextTurn(battle, this.now());
        });
        continue;
      }
      if (actor.kind === 'monster' && now >= battle.actorReadyAt) {
        void this.enqueue(battle, async () => {
          await this.monsterTurn(battle, actor.id);
        });
        continue;
      }
      if (actor.kind === 'player' && now >= battle.turnEndsAt) {
        void this.enqueue(battle, async () => {
          await this.applyPlayerAction(battle, actor.id, { action: 'attack' }, 'timeout');
        });
      }
    }
  }

  /** Chờ mọi việc đang xếp hàng của các trận xong (dùng cho kiểm thử và khi tắt server). */
  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  // ------------------------------------------------------------------ luồng chính

  private async applyPlayerAction(
    battle: ActiveBattle,
    characterId: string,
    request: Pick<BattleAction, 'action' | 'skillId' | 'itemId' | 'targetId'>,
    cause: 'action' | 'timeout',
  ): Promise<void> {
    if (battle.over) {
      return;
    }
    const actor = battle.players.get(characterId);
    if (!actor || !isAlive(actor)) {
      return;
    }
    if (battle.actorId !== characterId) {
      this.sendTo(
        characterId,
        Opcode.S2C_ERROR,
        this.errorPayload(ErrorCode.NOT_YOUR_TURN, 'chưa tới lượt của bạn'),
      );
      return;
    }

    const session = this.options.sessions.get(characterId);
    const events: BattleEvent[] = [];

    if (cause === 'action' && request.action === 'item') {
      const item = this.options.gameData.items.get(request.itemId ?? '');
      if (!item || item.kind !== 'consumable' || item.consumable === null) {
        this.reject(characterId, ErrorCode.ITEM_NOT_USABLE, 'vật phẩm này không dùng được');
        return;
      }
      // Tính trước xem có hồi được gì không: dùng vật phẩm lúc chỉ số đang đầy thì phải **không** mất món.
      const healed = this.applyConsumable(item, actor.hp, actor.maxHp, actor.mp, actor.maxMp);
      if (healed.hp === actor.hp && healed.mp === actor.mp) {
        this.reject(characterId, ErrorCode.ITEM_NO_EFFECT, 'chỉ số đang đầy, dùng lúc này thì phí');
        return;
      }
      if (!(await this.options.inventory.take(characterId, item.id, 1))) {
        this.reject(characterId, ErrorCode.ITEM_NOT_OWNED, 'bạn không có vật phẩm này trong túi');
        return;
      }
      const restoredHp = healed.hp - actor.hp;
      const restoredMp = healed.mp - actor.mp;
      actor.hp = healed.hp;
      actor.mp = healed.mp;
      if (restoredHp > 0) {
        events.push(
          this.event('heal', actor.id, {
            value: restoredHp,
            name: item.name,
            text: `${actor.name} dùng ${item.name}, hồi ${restoredHp} máu`,
          }),
        );
      }
      if (restoredMp > 0) {
        events.push(
          this.event('heal', actor.id, {
            value: restoredMp,
            name: item.name,
            text: `${actor.name} dùng ${item.name}, hồi ${restoredMp} nội lực`,
          }),
        );
      }
      if (session) {
        session.send(
          Opcode.S2C_INVENTORY_UPDATE,
          await this.options.inventory.toPacket(characterId),
        );
      }
      await this.conclude(battle, actor, 'item', events);
      return;
    }

    if (cause === 'action' && request.action === 'flee') {
      const target = this.firstLivingMonster(battle);
      const chance = target ? fleeChance(actor.stats.agility, target.speed) : 1;
      if (this.rng() < chance) {
        events.push(
          this.event('flee', actor.id, { text: `${actor.name} đã chạy thoát khỏi trận` }),
        );
        this.broadcast(
          battle,
          Opcode.S2C_BATTLE_RESULT,
          this.resultPayload(battle, actor.id, 'flee', events),
        );
        battle.players.delete(actor.id);
        await this.settlePlayer(battle, actor, 'fled');
        if (battle.players.size === 0) {
          await this.finish(battle, 'fled');
        } else {
          this.beginNextTurn(battle, this.now());
        }
        return;
      }
      events.push(
        this.event('flee_failed', actor.id, {
          text: `${actor.name} chạy không thoát, mất lượt này`,
        }),
      );
      await this.conclude(battle, actor, 'flee', events);
      return;
    }

    // Đòn đánh: chiêu nếu có `skillId`, còn lại là đánh thường (kể cả khi hết giờ).
    const skill = request.skillId ? this.skillOf(actor, request.skillId) : undefined;
    if (request.skillId && !skill) {
      this.reject(characterId, ErrorCode.SKILL_NOT_KNOWN, 'bạn chưa học chiêu này');
      return;
    }
    if (skill) {
      if (readyInTurns(actor, skill.id, battle.roundNo) > 0) {
        this.reject(
          characterId,
          ErrorCode.SKILL_COOLDOWN,
          `chiêu ${skill.name} còn ${readyInTurns(actor, skill.id, battle.roundNo)} vòng hồi`,
        );
        return;
      }
      if (actor.mp < skill.costMp) {
        this.reject(characterId, ErrorCode.NOT_ENOUGH_MP, 'không đủ nội lực để dùng chiêu này');
        return;
      }
      actor.mp -= skill.costMp;
      actor.cooldownUntil.set(skill.id, cooldownUntilRound(skill, battle.roundNo));
    }

    const target = this.pickTarget(battle, request.targetId) ?? this.firstLivingMonster(battle);
    if (!target) {
      await this.finish(battle, 'victory');
      return;
    }

    const base = skill ? skillBase(skill, actor) : normalAttackBase(actor.attack);
    const hit = rollHit(target, base, this.rng);
    target.hp = Math.max(0, target.hp - hit.damage);
    this.syncMonster(battle, target);

    const moveName = skill ? `chiêu ${skill.name}` : 'đánh thường';
    const prefix = cause === 'timeout' ? 'hết thời gian, tự động đánh thường' : moveName;
    events.push(
      this.event(cause === 'timeout' ? 'auto' : 'damage', actor.id, {
        targetId: target.id,
        value: hit.damage,
        critical: hit.critical,
        name: skill?.name,
        text:
          `${actor.name} ${prefix} gây ${hit.damage} sát thương lên ${target.name}` +
          (hit.critical ? ' (chí mạng)' : ''),
      }),
    );
    if (!isAlive(target)) {
      events.push(
        this.event('defeat', actor.id, {
          targetId: target.id,
          text: `${target.name} đã bị hạ gục`,
        }),
      );
    }

    await this.conclude(
      battle,
      actor,
      cause === 'timeout' ? 'timeout' : skill ? 'skill' : 'attack',
      events,
    );
  }

  /** Sau một hành động: phát kết quả rồi mở lượt kế tiếp, hoặc kết thúc trận nếu đã ngã ngũ. */
  private async conclude(
    battle: ActiveBattle,
    actor: Combatant,
    action: BattleResult['action'],
    events: BattleEvent[],
  ): Promise<void> {
    this.broadcast(
      battle,
      Opcode.S2C_BATTLE_RESULT,
      this.resultPayload(battle, actor.id, action, events),
    );

    if (this.allMonstersDead(battle)) {
      await this.finish(battle, 'victory');
      return;
    }
    if (this.allPlayersDead(battle)) {
      await this.finish(battle, 'defeat');
      return;
    }
    this.beginNextTurn(battle, this.now());
  }

  private async monsterTurn(battle: ActiveBattle, monsterId: string): Promise<void> {
    if (battle.over || battle.actorId !== monsterId) {
      return;
    }
    const monster = battle.monsters.get(monsterId);
    if (!monster || !isAlive(monster)) {
      this.beginNextTurn(battle, this.now());
      return;
    }
    const targets = [...battle.players.values()].filter(isAlive);
    const target = targets[Math.floor(this.rng() * targets.length)];
    if (!target) {
      await this.finish(battle, 'victory');
      return;
    }

    const hit = rollHit(target, normalAttackBase(monster.attack), this.rng);
    target.hp = Math.max(0, target.hp - hit.damage);

    const events: BattleEvent[] = [
      this.event('damage', monster.id, {
        targetId: target.id,
        value: hit.damage,
        critical: hit.critical,
        text:
          `${monster.name} đánh ${target.name} ${hit.damage} sát thương` +
          (hit.critical ? ' (chí mạng)' : ''),
      }),
    ];
    if (!isAlive(target)) {
      events.push(
        this.event('defeat', monster.id, {
          targetId: target.id,
          text: `${target.name} đã gục xuống`,
        }),
      );
    }

    this.broadcast(
      battle,
      Opcode.S2C_BATTLE_RESULT,
      this.resultPayload(battle, monster.id, 'attack', events),
    );

    if (this.allPlayersDead(battle)) {
      await this.finish(battle, 'defeat');
      return;
    }
    this.beginNextTurn(battle, this.now());
  }

  /** Kết thúc trận: tính thưởng, ghi database và phát `S2C_BATTLE_END` cho từng người. */
  private async finish(battle: ActiveBattle, outcome: BattleOutcome): Promise<void> {
    if (battle.over) {
      return;
    }
    battle.over = true;
    this.battles.delete(battle.id);

    const room = this.options.rooms.get(battle.mapId);
    const monster = battle.monsters.values().next().value as Combatant | undefined;

    // Trận kết thúc mà quái còn sống (chạy thoát hoặc thua): quái hồi đầy máu, nếu không thì người
    // chơi chỉ cần đánh rồi bỏ chạy vài lần là hạ được mọi con quái.
    if (outcome !== 'victory' && room) {
      for (const combatant of battle.monsters.values()) {
        room.setMonsterHp(combatant.id, combatant.maxHp, this.now());
      }
    }

    for (const combatant of [...battle.players.values()]) {
      await this.settlePlayer(battle, combatant, outcome, monster);
    }
  }

  /** Phần thưởng (thắng) hoặc hình phạt (thua) của **một** người chơi, rồi phát gói tin cho họ. */
  private async settlePlayer(
    battle: ActiveBattle,
    combatant: Combatant,
    outcome: BattleOutcome,
    monster?: Combatant,
  ): Promise<void> {
    const session = this.options.sessions.get(combatant.id);
    const record = await this.options.characters.findById(combatant.id);
    const monsterData = monster ? this.monsterDataOf(battle, monster.id) : undefined;
    const participants = this.participantsPayload(battle);

    if (!record) {
      // Nhân vật biến mất giữa trận (dữ liệu bị xoá): chỉ cần kết thúc trận, không có gì để ghi.
      session?.send(Opcode.S2C_BATTLE_END, {
        battleId: battle.id,
        outcome,
        monsterName: monster?.name ?? 'quái',
        rewards: null,
        participants,
      } satisfies BattleEnd);
      return;
    }

    if (outcome === 'victory' && monsterData) {
      const expReward = monsterData.expReward;
      const yenReward =
        monsterData.yenMin + Math.floor(this.rng() * (monsterData.yenMax - monsterData.yenMin + 1));
      const gain = applyExpGain(record.level, record.exp, expReward);

      // Trang bị ảnh hưởng máu/nội lực tối đa nên phải cộng vào **cả hai** vế so sánh: phần tăng
      // thêm khi lên cấp vẫn chỉ là phần do cấp, không phải do đồ đang mặc.
      const bonus = await this.options.equipment.bonusFor(combatant.id);
      const before = resolvedFor(this.options.gameData, record, bonus);
      const after = resolvedFor(this.options.gameData, { ...record, level: gain.level }, bonus);
      const hp = this.clamp(combatant.hp + (after.maxHp - before.maxHp), 1, after.maxHp);
      const mp = this.clamp(combatant.mp + (after.maxMp - before.maxMp), 0, after.maxMp);
      combatant.hp = hp;
      combatant.mp = mp;

      const drops: { itemId: string; name: string; qty: number }[] = [];
      for (const drop of monsterData.drops) {
        if (this.rng() >= drop.chance) {
          continue;
        }
        const qty = drop.minQty + Math.floor(this.rng() * (drop.maxQty - drop.minQty + 1));
        const granted = await this.options.inventory.grant(combatant.id, drop.itemId, qty);
        if (granted === 'ok') {
          drops.push({
            itemId: drop.itemId,
            name: this.options.gameData.items.get(drop.itemId)?.name ?? drop.itemId,
            qty,
          });
        }
      }

      await this.options.characters.updateProgress(combatant.id, {
        level: gain.level,
        exp: gain.exp,
        yen: record.yen + yenReward,
      });
      await this.options.characters.updateVitals(combatant.id, hp, mp);

      session?.send(Opcode.S2C_BATTLE_END, {
        battleId: battle.id,
        outcome,
        monsterName: monster?.name ?? 'quái',
        rewards: {
          exp: expReward,
          yen: yenReward,
          level: gain.level,
          levelsGained: gain.levelsGained,
          drops,
        },
        participants,
      } satisfies BattleEnd);

      if (session) {
        const updated: CharacterRecord = {
          ...record,
          level: gain.level,
          exp: gain.exp,
          yen: record.yen + yenReward,
        };
        this.sendCharacter(session, updated, hp, mp, bonus);
        if (gain.levelsGained > 0) {
          const learned = skillsOf(this.options.gameData, {
            class: record.class,
            level: gain.level,
          }).filter((skill) => skill.levelRequired > record.level);
          const payload: LevelUp = {
            character: characterStatsPayload({
              record: updated,
              data: this.options.gameData,
              bonus,
              hp,
              mp,
            }),
            levelsGained: gain.levelsGained,
            learnedSkills: learned.map((skill) => ({ skillId: skill.id, name: skill.name })),
          };
          session.send(Opcode.S2C_LEVEL_UP, payload);
        }
        session.send(
          Opcode.S2C_INVENTORY_UPDATE,
          await this.options.inventory.toPacket(combatant.id),
        );
      }
      return;
    }

    if (outcome === 'defeat') {
      const bonus = await this.options.equipment.bonusFor(combatant.id);
      const resolved = resolvedFor(this.options.gameData, record, bonus);
      const hp = Math.max(1, Math.round(resolved.maxHp * REVIVE_HP_RATIO));
      const yenLoss = Math.floor(record.yen * DEFEAT_YEN_LOSS_RATIO);
      await this.options.characters.updateVitals(combatant.id, hp, resolved.maxMp);
      await this.options.characters.updateProgress(combatant.id, {
        level: record.level,
        exp: record.exp,
        yen: record.yen - yenLoss,
      });

      session?.send(Opcode.S2C_BATTLE_END, {
        battleId: battle.id,
        outcome,
        monsterName: monster?.name ?? 'quái',
        rewards: null,
        participants,
      } satisfies BattleEnd);

      if (session) {
        const updated: CharacterRecord = {
          ...record,
          yen: record.yen - yenLoss,
        };
        this.sendCharacter(session, updated, hp, resolved.maxMp, bonus);
      }
      this.options.onDefeat(combatant.id);
      return;
    }

    // Chạy thoát: giữ nguyên máu/nội lực đang có, không thưởng không phạt.
    await this.options.characters.updateVitals(
      combatant.id,
      this.clamp(combatant.hp, 1, combatant.maxHp),
      this.clamp(combatant.mp, 0, combatant.maxMp),
    );
    session?.send(Opcode.S2C_BATTLE_END, {
      battleId: battle.id,
      outcome,
      monsterName: monster?.name ?? 'quái',
      rewards: null,
      participants,
    } satisfies BattleEnd);
  }

  // ---------------------------------------------------------------- dựng trạng thái

  private createBattle(room: Room, monster: RoomMonster, player: Combatant): ActiveBattle {
    this.sequence += 1;
    const battle: ActiveBattle = {
      id: `btl:${room.map.id}:${monster.id}:${this.sequence}`,
      mapId: room.map.id,
      players: new Map([[player.id, player]]),
      monsters: new Map([[monster.id, this.monsterCombatant(monster)]]),
      roundNo: 0,
      order: [],
      orderIndex: 0,
      actorId: undefined,
      turnEndsAt: 0,
      actorReadyAt: 0,
      over: false,
    };
    this.battles.set(battle.id, battle);
    return battle;
  }

  private playerCombatant(record: CharacterRecord, bonus: StatBlock): Combatant | undefined {
    if (!this.options.gameData.classes.has(record.school)) {
      return undefined;
    }
    const resolved = resolvedFor(this.options.gameData, record, bonus);
    return {
      id: record.id,
      kind: 'player',
      name: record.name,
      level: record.level,
      maxHp: resolved.maxHp,
      maxMp: resolved.maxMp,
      hp: currentHp(record, resolved.maxHp),
      mp: currentMp(record, resolved.maxMp),
      attack: resolved.attack,
      defense: resolved.defense,
      speed: resolved.speed,
      stats: {
        strength: resolved.strength,
        agility: resolved.agility,
        spirit: resolved.spirit,
      },
      skills: skillsOf(this.options.gameData, record),
      cooldownUntil: new Map(),
    };
  }

  /** Quái chỉ đánh thường nên không có chiêu; máu lấy từ trạng thái đang có trên bản đồ. */
  private monsterCombatant(monster: RoomMonster): Combatant {
    return {
      id: monster.id,
      kind: 'monster',
      name: monster.name,
      level: monster.level,
      maxHp: monster.maxHp,
      maxMp: 0,
      hp: monster.hp,
      mp: 0,
      attack: monster.attack,
      defense: monster.defense,
      speed: monster.speed,
      stats: { strength: 0, agility: 0, spirit: 0 },
      skills: [],
      cooldownUntil: new Map(),
    };
  }

  /**
   * Mở lượt kế tiếp. Hết vòng thì tăng số vòng và xếp lại thứ tự theo tốc độ — người vừa vào trận
   * giữa chừng cũng có lượt từ vòng sau.
   */
  private beginNextTurn(battle: ActiveBattle, now: number, announce = true): void {
    if (battle.over) {
      return;
    }
    for (;;) {
      if (battle.orderIndex >= battle.order.length) {
        battle.roundNo += 1;
        battle.order = turnOrder(
          [...battle.players.values(), ...battle.monsters.values()],
          this.rng,
        );
        battle.orderIndex = 0;
      }

      const id = battle.order[battle.orderIndex];
      battle.orderIndex += 1;
      if (id === undefined) {
        // Không còn ai sống: quyết định ngay thay vì để trận treo.
        void this.enqueue(battle, async () => {
          await this.finish(battle, this.allMonstersDead(battle) ? 'victory' : 'defeat');
        });
        return;
      }

      const combatant = this.findCombatant(battle, id);
      if (!combatant || !isAlive(combatant)) {
        continue;
      }

      battle.actorId = id;
      battle.turnEndsAt = now + BATTLE_TURN_MS;
      battle.actorReadyAt = now + (combatant.kind === 'monster' ? MONSTER_TURN_DELAY_MS : 0);
      if (announce) {
        const payload: BattleTurn = {
          battleId: battle.id,
          roundNo: battle.roundNo,
          actorId: id,
          turnMs: BATTLE_TURN_MS,
          turnEndsAt: battle.turnEndsAt,
        };
        this.broadcast(battle, Opcode.S2C_BATTLE_TURN, payload);
      }
      return;
    }
  }

  /** Ghi máu của quái trong trận xuống bản đồ (client thấy thanh máu đổi ngay trên map). */
  private syncMonster(battle: ActiveBattle, monster: Combatant): void {
    const room = this.options.rooms.get(battle.mapId);
    if (room) {
      room.setMonsterHp(monster.id, monster.hp, this.now());
    }
  }

  // ------------------------------------------------------------------ tiện ích

  private battleOf(characterId: string): ActiveBattle | undefined {
    for (const battle of this.battles.values()) {
      if (battle.players.has(characterId)) {
        return battle;
      }
    }
    return undefined;
  }

  private battleForMonster(mapId: string, monsterId: string): ActiveBattle | undefined {
    for (const battle of this.battles.values()) {
      if (battle.mapId === mapId && battle.monsters.has(monsterId)) {
        return battle;
      }
    }
    return undefined;
  }

  private findCombatant(battle: ActiveBattle, id: string): Combatant | undefined {
    return battle.players.get(id) ?? battle.monsters.get(id);
  }

  private firstLivingMonster(battle: ActiveBattle): Combatant | undefined {
    for (const monster of battle.monsters.values()) {
      if (isAlive(monster)) {
        return monster;
      }
    }
    return undefined;
  }

  private pickTarget(battle: ActiveBattle, targetId?: string): Combatant | undefined {
    if (!targetId) {
      return undefined;
    }
    const target = battle.monsters.get(targetId);
    return target && isAlive(target) ? target : undefined;
  }

  private allMonstersDead(battle: ActiveBattle): boolean {
    return [...battle.monsters.values()].every((monster) => !isAlive(monster));
  }

  private allPlayersDead(battle: ActiveBattle): boolean {
    return [...battle.players.values()].every((player) => !isAlive(player));
  }

  private skillOf(combatant: Combatant, skillId: string): Skill | undefined {
    return combatant.skills.find((skill) => skill.id === skillId);
  }

  private monsterDataOf(battle: ActiveBattle, monsterId: string): Monster | undefined {
    const room = this.options.rooms.get(battle.mapId);
    const placement = room?.monsters().find((monster) => monster.id === monsterId);
    return placement ? this.options.gameData.monsters.get(placement.monsterId) : undefined;
  }

  /** Kết quả dùng một vật phẩm hồi phục, đã kẹp ở mức tối đa. */
  private applyConsumable(
    item: Item,
    hp: number,
    maxHp: number,
    mp: number,
    maxMp: number,
  ): { hp: number; mp: number } {
    const effect = item.consumable;
    return {
      hp: effect ? this.clamp(hp + effect.healHp, 0, maxHp) : hp,
      mp: effect ? this.clamp(mp + effect.healMp, 0, maxMp) : mp,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private event(
    kind: BattleEvent['kind'],
    actorId: string,
    fields: Omit<BattleEvent, 'kind' | 'actorId'>,
  ): BattleEvent {
    return { kind, actorId, ...fields };
  }

  private toPayload(combatant: Combatant, roundNo: number): CombatantPayload {
    const payload: CombatantPayload = {
      id: combatant.id,
      kind: combatant.kind,
      name: combatant.name,
      level: combatant.level,
      hp: Math.max(0, combatant.hp),
      maxHp: combatant.maxHp,
      mp: Math.max(0, combatant.mp),
      maxMp: combatant.maxMp,
      attack: combatant.attack,
      defense: combatant.defense,
      speed: combatant.speed,
      alive: isAlive(combatant),
    };
    if (combatant.kind === 'player') {
      payload.skills = combatant.skills.map((skill) => ({
        skillId: skill.id,
        name: skill.name,
        costMp: skill.costMp,
        cooldownTurns: cooldownTurnsFor(skill),
        levelRequired: skill.levelRequired,
        readyInTurns: readyInTurns(combatant, skill.id, roundNo),
      }));
    }
    return payload;
  }

  private participantsPayload(battle: ActiveBattle): CombatantPayload[] {
    return [
      ...[...battle.monsters.values()].map((monster) => this.toPayload(monster, battle.roundNo)),
      ...[...battle.players.values()].map((player) => this.toPayload(player, battle.roundNo)),
    ];
  }

  private startPayload(battle: ActiveBattle): BattleStart {
    return {
      battleId: battle.id,
      roundNo: battle.roundNo,
      participants: this.participantsPayload(battle),
      actorId: battle.actorId ?? '',
      turnMs: BATTLE_TURN_MS,
      turnEndsAt: battle.turnEndsAt,
    };
  }

  private resultPayload(
    battle: ActiveBattle,
    actorId: string,
    action: BattleResult['action'],
    events: BattleEvent[],
  ): BattleResult {
    return {
      battleId: battle.id,
      roundNo: battle.roundNo,
      actorId,
      action,
      events,
      participants: this.participantsPayload(battle),
    };
  }

  private sendCharacter(
    session: GameSession,
    record: CharacterRecord,
    hp: number,
    mp: number,
    bonus: StatBlock,
  ): void {
    session.send(
      Opcode.S2C_CHARACTER,
      characterStatsPayload({ record, data: this.options.gameData, bonus, hp, mp }),
    );
  }

  private broadcast(battle: ActiveBattle, op: number, payload: unknown): void {
    for (const characterId of battle.players.keys()) {
      this.sendTo(characterId, op, payload);
    }
  }

  private sendTo(characterId: string, op: number, payload: unknown): void {
    this.options.sessions.get(characterId)?.send(op, payload);
  }

  private reject(characterId: string, code: ErrorCode, message: string): void {
    this.sendTo(characterId, Opcode.S2C_ERROR, this.errorPayload(code, message));
  }

  private errorPayload(code: ErrorCode, message: string) {
    return { code, message, fatal: false };
  }

  /**
   * Xếp việc đổi trạng thái trận vào hàng đợi của trận đó. Trả về promise của chính việc này để
   * người gọi (và kiểm thử) chờ được tới lúc trạng thái đã ổn định.
   */
  private enqueue(battle: ActiveBattle, task: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(battle.id) ?? Promise.resolve();
    const next = previous
      .then(task)
      .catch((error: unknown) => {
        this.options.onError?.(error);
      })
      .finally(() => {
        if (this.chains.get(battle.id) === next) {
          this.chains.delete(battle.id);
        }
      });
    this.chains.set(battle.id, next);
    return next;
  }
}

import {
  ARENA_MIN_LEVEL,
  ARENA_RATING_FLOOR,
  ARENA_START_RATING,
  ARENA_TURN_MS,
  ErrorCode,
  Opcode,
  arenaDelta,
  type ArenaEnd,
  type ArenaState,
  type BattleAction,
  type BattleEvent,
  type BattleResult,
  type BattleStart,
  type BattleTurn,
  type Combatant as CombatantPayload,
  type Skill,
} from '@ninja/shared';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { characterArena } from '../../db/schema.js';
import type { TickScheduler } from '../../core/tick.js';
import type { CharacterService } from '../character/service.js';
import { currentHp, currentMp, resolvedFor, skillsOf } from '../character/stats.js';
import type { EquipmentService } from '../equipment/service.js';
import type { SessionRegistry } from '../../net/session-registry.js';
import type { GameData } from '../../world/game-data.js';
import {
  cooldownUntilRound,
  isAlive,
  normalAttackBase,
  rollHit,
  skillBase,
  turnOrder,
  type Combatant,
  type Rng,
} from '../../battle/engine.js';

interface Duel {
  readonly id: string;
  readonly players: [Combatant, Combatant];
  readonly ratings: [number, number];
  roundNo: number;
  actorId: string;
  turnEndsAt: number;
}

/** Matchmaking + 1v1 PvP. Sát thương/thứ tự lượt dùng chung các hàm thuần của battle/engine.ts. */
export class ArenaService {
  private readonly queue = new Map<string, number>();
  private readonly admissions = new Set<string>();
  private readonly pairings = new Set<string>();
  private readonly duels = new Map<string, Duel>();
  private readonly duelByPlayer = new Map<string, string>();
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly db: Db,
    private readonly gameData: GameData,
    private readonly characters: CharacterService,
    private readonly equipment: EquipmentService,
    private readonly sessions: SessionRegistry,
    tick: TickScheduler,
    options: { now?: () => number; rng?: Rng } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.rng = options.rng ?? Math.random;
    this.unsubscribe = tick.onTick((now) => this.onTick(now));
  }

  dispose(): void {
    this.unsubscribe();
    this.queue.clear();
    this.admissions.clear();
    this.pairings.clear();
    this.duels.clear();
    this.duelByPlayer.clear();
  }

  isEngaged(characterId: string): boolean {
    return (
      this.admissions.has(characterId) ||
      this.queue.has(characterId) ||
      this.pairings.has(characterId) ||
      this.duelByPlayer.has(characterId)
    );
  }

  isDueling(characterId: string): boolean {
    return this.duelByPlayer.has(characterId);
  }

  async state(characterId: string): Promise<ArenaState> {
    const rating = await this.ratingFor(characterId);
    return {
      queued: this.queue.has(characterId),
      queueSize: this.queue.size,
      rating: rating.rating,
      wins: rating.wins,
      losses: rating.losses,
    };
  }

  async queuePlayer(characterId: string): Promise<void> {
    if (this.isEngaged(characterId)) {
      await this.sendState(characterId);
      return;
    }
    this.admissions.add(characterId);
    try {
      const record = await this.characters.findById(characterId);
      if (!record) {
        this.sessions
          .get(characterId)
          ?.sendError(ErrorCode.NO_CHARACTER, 'không tìm thấy nhân vật');
        return;
      }
      if (record.level < ARENA_MIN_LEVEL) {
        this.sessions
          .get(characterId)
          ?.sendError(ErrorCode.ARENA_LEVEL_LOW, `cần đạt cấp ${ARENA_MIN_LEVEL} để vào Lôi Đài`);
        return;
      }
      await this.ensureRating(characterId);
      if (this.duelByPlayer.has(characterId) || this.pairings.has(characterId)) return;
      if (!this.queue.has(characterId)) this.queue.set(characterId, this.now());
      const opponentId = [...this.queue.keys()].find((id) => id !== characterId);
      if (opponentId) {
        this.queue.delete(characterId);
        this.queue.delete(opponentId);
        this.pairings.add(characterId);
        this.pairings.add(opponentId);
        try {
          await this.startDuel(characterId, opponentId);
        } finally {
          this.pairings.delete(characterId);
          this.pairings.delete(opponentId);
        }
      }
      await this.publishQueueStates();
    } finally {
      this.admissions.delete(characterId);
    }
  }

  async cancel(characterId: string): Promise<void> {
    if (!this.queue.delete(characterId)) {
      this.sessions
        .get(characterId)
        ?.sendError(ErrorCode.ARENA_NOT_QUEUED, 'bạn không ở hàng chờ Lôi Đài');
      return;
    }
    await this.publishQueueStates();
  }

  async action(characterId: string, request: BattleAction): Promise<void> {
    const duelId = this.duelByPlayer.get(characterId);
    const duel = duelId ? this.duels.get(duelId) : undefined;
    if (!duel || duel.id !== request.battleId) {
      this.sessions
        .get(characterId)
        ?.sendError(ErrorCode.BATTLE_NOT_FOUND, 'không tìm thấy trận Lôi Đài này');
      return;
    }
    if (duel.actorId !== characterId) {
      this.sessions.get(characterId)?.sendError(ErrorCode.NOT_YOUR_TURN, 'chưa đến lượt của bạn');
      return;
    }
    if (request.action === 'flee') {
      this.sessions
        .get(characterId)
        ?.sendError(ErrorCode.ARENA_NO_FLEE, 'không thể bỏ chạy khỏi trận Lôi Đài');
      return;
    }
    if (request.action === 'item') {
      this.sessions
        .get(characterId)
        ?.sendError(ErrorCode.ITEM_NOT_USABLE, 'không thể dùng vật phẩm trong Lôi Đài');
      return;
    }
    const actor = duel.players.find((player) => player.id === characterId)!;
    const target = duel.players.find((player) => player.id !== characterId)!;
    if (request.targetId && request.targetId !== target.id) {
      this.sessions.get(characterId)?.sendError(ErrorCode.INVALID_TARGET, 'mục tiêu không hợp lệ');
      return;
    }
    await this.attack(
      duel,
      actor,
      target,
      request.action === 'skill' ? request.skillId : undefined,
      false,
    );
  }

  async leave(characterId: string): Promise<void> {
    this.queue.delete(characterId);
    const duelId = this.duelByPlayer.get(characterId);
    const duel = duelId ? this.duels.get(duelId) : undefined;
    if (duel) {
      const winner = duel.players.find((player) => player.id !== characterId);
      if (winner) await this.finish(duel, winner.id, 'opponent_left');
    }
    await this.publishQueueStates();
  }

  private async startDuel(firstId: string, secondId: string): Promise<void> {
    const [firstRecord, secondRecord, firstBonus, secondBonus, firstRating, secondRating] =
      await Promise.all([
        this.characters.findById(firstId),
        this.characters.findById(secondId),
        this.equipment.bonusFor(firstId),
        this.equipment.bonusFor(secondId),
        this.ratingFor(firstId),
        this.ratingFor(secondId),
      ]);
    if (!firstRecord || !secondRecord) return;
    const first = this.makeCombatant(firstRecord, firstBonus);
    const second = this.makeCombatant(secondRecord, secondBonus);
    const duel: Duel = {
      id: `arena:${randomUUID()}`,
      players: [first, second],
      ratings: [firstRating.rating, secondRating.rating],
      roundNo: 1,
      actorId: turnOrder([first, second], this.rng)[0] ?? first.id,
      turnEndsAt: this.now() + ARENA_TURN_MS,
    };
    this.duels.set(duel.id, duel);
    this.duelByPlayer.set(first.id, duel.id);
    this.duelByPlayer.set(second.id, duel.id);
    const start: BattleStart = {
      battleId: duel.id,
      roundNo: duel.roundNo,
      participants: duel.players.map((player) => this.toPayload(player)),
      actorId: duel.actorId,
      turnMs: ARENA_TURN_MS,
      turnEndsAt: duel.turnEndsAt,
      mode: 'arena',
    };
    this.broadcast(duel, Opcode.S2C_BATTLE_START, start);
    await Promise.all([this.sendState(first.id), this.sendState(second.id)]);
  }

  private makeCombatant(
    record: NonNullable<Awaited<ReturnType<CharacterService['findById']>>>,
    bonus: Awaited<ReturnType<EquipmentService['bonusFor']>>,
  ): Combatant {
    const stats = resolvedFor(this.gameData, record, bonus);
    return {
      id: record.id,
      kind: 'player',
      name: record.name,
      level: record.level,
      maxHp: stats.maxHp,
      maxMp: stats.maxMp,
      hp: currentHp(record, stats.maxHp),
      mp: currentMp(record, stats.maxMp),
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      stats: { strength: stats.strength, agility: stats.agility, spirit: stats.spirit },
      skills: skillsOf(this.gameData, record),
      cooldownUntil: new Map(),
    };
  }

  private async attack(
    duel: Duel,
    actor: Combatant,
    target: Combatant,
    skillId: string | undefined,
    timeout: boolean,
  ): Promise<void> {
    let skill: Skill | undefined;
    if (skillId) {
      skill = actor.skills.find((candidate) => candidate.id === skillId);
      if (!skill) {
        this.sessions.get(actor.id)?.sendError(ErrorCode.SKILL_NOT_KNOWN, 'bạn chưa học chiêu này');
        return;
      }
      const readyAt = actor.cooldownUntil.get(skill.id) ?? 0;
      if (readyAt > duel.roundNo) {
        this.sessions.get(actor.id)?.sendError(ErrorCode.SKILL_COOLDOWN, 'chiêu này đang hồi');
        return;
      }
      if (actor.mp < skill.costMp) {
        this.sessions.get(actor.id)?.sendError(ErrorCode.NOT_ENOUGH_MP, 'không đủ nội lực');
        return;
      }
      actor.mp -= skill.costMp;
      actor.cooldownUntil.set(skill.id, cooldownUntilRound(skill, duel.roundNo));
    }
    const hit = rollHit(
      target,
      skill ? skillBase(skill, actor) : normalAttackBase(actor.attack),
      this.rng,
    );
    target.hp = Math.max(0, target.hp - hit.damage);
    const events: BattleEvent[] = [
      {
        kind: timeout ? 'auto' : 'damage',
        actorId: actor.id,
        targetId: target.id,
        value: hit.damage,
        critical: hit.critical,
        ...(skill ? { name: skill.name } : {}),
        text: `${actor.name} ${skill ? `dùng ${skill.name}` : 'đánh thường'} gây ${hit.damage} sát thương lên ${target.name}${hit.critical ? ' (chí mạng)' : ''}`,
      },
    ];
    if (!isAlive(target))
      events.push({
        kind: 'defeat',
        actorId: actor.id,
        targetId: target.id,
        text: `${target.name} đã bị hạ gục`,
      });
    const result: BattleResult = {
      battleId: duel.id,
      roundNo: duel.roundNo,
      actorId: actor.id,
      action: timeout ? 'timeout' : skill ? 'skill' : 'attack',
      events,
      participants: duel.players.map((player) => this.toPayload(player)),
    };
    this.broadcast(duel, Opcode.S2C_BATTLE_RESULT, result);
    if (!isAlive(target)) {
      await this.finish(duel, actor.id, 'defeat');
      return;
    }
    duel.roundNo += 1;
    duel.actorId = target.id;
    duel.turnEndsAt = this.now() + ARENA_TURN_MS;
    const turn: BattleTurn = {
      battleId: duel.id,
      roundNo: duel.roundNo,
      actorId: duel.actorId,
      turnMs: ARENA_TURN_MS,
      turnEndsAt: duel.turnEndsAt,
    };
    this.broadcast(duel, Opcode.S2C_BATTLE_TURN, turn);
  }

  private async finish(duel: Duel, winnerId: string, reason: ArenaEnd['reason']): Promise<void> {
    if (!this.duels.delete(duel.id)) return;
    for (const player of duel.players) this.duelByPlayer.delete(player.id);
    const winnerIndex = duel.players[0].id === winnerId ? 0 : 1;
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const before = duel.ratings;
    const deltas: [number, number] = [
      arenaDelta(before[0], before[1], winnerIndex === 0),
      arenaDelta(before[1], before[0], winnerIndex === 1),
    ];
    const after: [number, number] = [
      Math.max(ARENA_RATING_FLOOR, before[0] + deltas[0]),
      Math.max(ARENA_RATING_FLOOR, before[1] + deltas[1]),
    ];
    await Promise.all(
      duel.players.map((player, index) =>
        this.db
          .insert(characterArena)
          .values({
            characterId: player.id,
            rating: after[index]!,
            wins: index === winnerIndex ? 1 : 0,
            losses: index === loserIndex ? 1 : 0,
          })
          .onConflictDoUpdate({
            target: characterArena.characterId,
            set: {
              rating: after[index]!,
              wins: sql`${characterArena.wins} + ${index === winnerIndex ? 1 : 0}`,
              losses: sql`${characterArena.losses} + ${index === loserIndex ? 1 : 0}`,
              updatedAt: new Date(this.now()),
            },
          }),
      ),
    );
    for (let index = 0; index < 2; index += 1) {
      const player = duel.players[index]!;
      const [row] = await this.db
        .select()
        .from(characterArena)
        .where(eq(characterArena.characterId, player.id))
        .limit(1);
      const opponent = duel.players[1 - index]!;
      const end: ArenaEnd = {
        battleId: duel.id,
        outcome: index === winnerIndex ? 'win' : 'loss',
        reason,
        ratingBefore: before[index]!,
        ratingAfter: after[index]!,
        ratingDelta: after[index]! - before[index]!,
        opponentName: opponent.name,
        opponentRatingAfter: after[1 - index]!,
        wins: row?.wins ?? 0,
        losses: row?.losses ?? 0,
      };
      this.sessions.get(player.id)?.send(Opcode.S2C_ARENA_END, end);
      await this.sendState(player.id);
    }
  }

  private toPayload(player: Combatant): CombatantPayload {
    return {
      id: player.id,
      kind: player.kind,
      name: player.name,
      level: player.level,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
      attack: player.attack,
      defense: player.defense,
      speed: player.speed,
      alive: isAlive(player),
      skills: player.skills.map((skill) => ({
        skillId: skill.id,
        name: skill.name,
        costMp: skill.costMp,
        cooldownTurns: Math.max(0, (player.cooldownUntil.get(skill.id) ?? 0) - 1),
        levelRequired: skill.levelRequired,
        readyInTurns: Math.max(0, (player.cooldownUntil.get(skill.id) ?? 0) - 1),
      })),
    };
  }

  private async ensureRating(characterId: string): Promise<void> {
    await this.db.insert(characterArena).values({ characterId }).onConflictDoNothing();
  }

  private async ratingFor(
    characterId: string,
  ): Promise<{ rating: number; wins: number; losses: number }> {
    await this.ensureRating(characterId);
    const [row] = await this.db
      .select()
      .from(characterArena)
      .where(eq(characterArena.characterId, characterId))
      .limit(1);
    return row
      ? { rating: row.rating, wins: row.wins, losses: row.losses }
      : { rating: ARENA_START_RATING, wins: 0, losses: 0 };
  }

  private async sendState(characterId: string): Promise<void> {
    this.sessions.get(characterId)?.send(Opcode.S2C_ARENA_STATE, await this.state(characterId));
  }

  private async publishQueueStates(): Promise<void> {
    await Promise.all([...this.queue.keys()].map((characterId) => this.sendState(characterId)));
  }

  private broadcast(duel: Duel, op: number, payload: unknown): void {
    for (const player of duel.players) this.sessions.get(player.id)?.send(op, payload);
  }

  private onTick(now: number): void {
    for (const duel of this.duels.values()) {
      if (now < duel.turnEndsAt) continue;
      const actor = duel.players.find((player) => player.id === duel.actorId);
      const target = duel.players.find((player) => player.id !== duel.actorId);
      if (actor && target) void this.attack(duel, actor, target, undefined, true);
    }
  }
}

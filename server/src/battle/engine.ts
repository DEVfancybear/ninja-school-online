import {
  CRITICAL_CHANCE,
  CRITICAL_MULTIPLIER,
  DAMAGE_VARIANCE,
  FLEE_AGILITY_FACTOR,
  FLEE_BASE_CHANCE,
  FLEE_MAX_CHANCE,
  FLEE_MIN_CHANCE,
  MIN_DAMAGE,
  NORMAL_ATTACK_FACTOR,
  NORMAL_ATTACK_POWER,
  skillCooldownTurns,
  type Skill,
} from '@ninja/shared';

/** Ai đó đang đánh nhau: người chơi hoặc quái. */
export const COMBATANT_KINDS = ['player', 'monster'] as const;
export type CombatantKind = (typeof COMBATANT_KINDS)[number];

/**
 * Trạng thái chiến đấu của một thực thể. Chỉ số đã **chốt lúc vào trận** — M3 chưa có trang bị dùng
 * được nên không có gì đổi giữa trận, đổi sau này thì phải tính lại khi vào trận.
 */
export interface Combatant {
  readonly id: string;
  readonly kind: CombatantKind;
  readonly name: string;
  readonly level: number;
  readonly maxHp: number;
  readonly maxMp: number;
  hp: number;
  mp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  /** Chỉ số gốc để tính chiêu theo sức mạnh/nhanh nhẹn/tinh thần; quái để 0 vì chỉ đánh thường. */
  readonly stats: { readonly strength: number; readonly agility: number; readonly spirit: number };
  /** Chiêu chủ động đã học (quái: rỗng). */
  readonly skills: readonly Skill[];
  /** Vòng sớm nhất được dùng lại từng chiêu, theo `skillId`. */
  readonly cooldownUntil: Map<string, number>;
}

/** Nguồn ngẫu nhiên; tách ra để kiểm thử bằng số giả. */
export type Rng = () => number;

export function isAlive(combatant: Combatant): boolean {
  return combatant.hp > 0;
}

/** Sát thương gốc của đòn đánh thường: `power + hệ số × sức tấn công`. */
export function normalAttackBase(attack: number): number {
  return NORMAL_ATTACK_POWER + NORMAL_ATTACK_FACTOR * attack;
}

/** Sát thương gốc của một chiêu: `power + hệ số × chỉ số` mà chiêu ăn theo. */
export function skillBase(skill: Skill, attacker: Combatant): number {
  return skill.power + skill.scale.factor * attacker.stats[skill.scale.stat];
}

export interface Hit {
  readonly damage: number;
  readonly critical: boolean;
}

/**
 * Một đòn đánh: dao động ±`DAMAGE_VARIANCE`, có thể chí mạng, trừ phòng thủ của mục tiêu, và **luôn**
 * gây ít nhất `MIN_DAMAGE` — phòng thủ cao không được biến trận thành bất tử.
 */
export function rollHit(target: Combatant, base: number, rng: Rng): Hit {
  const critical = rng() < CRITICAL_CHANCE;
  const variance = 1 + (rng() * 2 - 1) * DAMAGE_VARIANCE;
  const rolled = base * variance * (critical ? CRITICAL_MULTIPLIER : 1);
  return {
    damage: Math.max(MIN_DAMAGE, Math.round(rolled) - target.defense),
    critical,
  };
}

/**
 * Thứ tự hành động của một vòng: tốc độ giảm dần, bằng nhau thì ngẫu nhiên. Chỉ gồm người còn sống —
 * người chết vẫn nằm trong trận (chờ hồi sinh sau) nhưng không tới lượt.
 */
export function turnOrder(combatants: readonly Combatant[], rng: Rng): string[] {
  return combatants
    .filter(isAlive)
    .map((combatant) => ({ combatant, tieBreak: rng() }))
    .sort((a, b) => b.combatant.speed - a.combatant.speed || a.tieBreak - b.tieBreak)
    .map((entry) => entry.combatant.id);
}

/** Tỉ lệ chạy thoát, kẹp trong `[FLEE_MIN_CHANCE, FLEE_MAX_CHANCE]` để không bao giờ là chắc chắn. */
export function fleeChance(playerAgility: number, opponentSpeed: number): number {
  const raw = FLEE_BASE_CHANCE + (playerAgility - opponentSpeed) * FLEE_AGILITY_FACTOR;
  return Math.min(FLEE_MAX_CHANCE, Math.max(FLEE_MIN_CHANCE, raw));
}

/** Số vòng phải chờ sau khi dùng một chiêu. */
export function cooldownTurnsFor(skill: Skill): number {
  return skillCooldownTurns(skill.cooldownMs);
}

/** Vòng sớm nhất được dùng lại chiêu này, tính từ vòng đang chơi. */
export function cooldownUntilRound(skill: Skill, roundNo: number): number {
  return roundNo + cooldownTurnsFor(skill);
}

/** Số vòng còn phải chờ của một chiêu ở vòng hiện tại (`0` là dùng được ngay). */
export function readyInTurns(combatant: Combatant, skillId: string, roundNo: number): number {
  const until = combatant.cooldownUntil.get(skillId);
  if (until === undefined) {
    return 0;
  }
  return Math.max(0, until - roundNo);
}

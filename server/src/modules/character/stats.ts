import {
  defenseFromAgility,
  expToNextLevel,
  learnedSkills,
  skillCooldownTurns,
  statsAtLevel,
  type BattleSkill,
  type Character,
  type CharacterStats,
  type Skill,
} from '@ninja/shared';
import type { GameData } from '../../world/game-data.js';

/** Mỗi điểm sức mạnh cộng ngần này vào sức tấn công; thêm 1 theo cấp để lên cấp là mạnh lên thật. */
export const ATTACK_PER_STRENGTH = 2;

/** Dữ liệu cần để tính chỉ số: chỉ có trong hàng `characters`, không có trong gói tin REST. */
export interface CharacterRecord extends Character {
  /** Máu hiện tại; `null` là đang đầy (xem `server/src/db/schema.ts`). */
  readonly hp: number | null;
  readonly mp: number | null;
}

/** Chỉ số đã suy ra ở một cấp; mọi hệ thống khác (trận đấu, HUD) dùng đúng con số này. */
export interface ResolvedStats {
  readonly strength: number;
  readonly agility: number;
  readonly spirit: number;
  readonly maxHp: number;
  readonly maxMp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

/**
 * Chỉ số của một nhân vật: hệ số phái trong `game-data/classes/` nhân theo cấp.
 *
 * Công thức (chốt ở M3, ghi cả ở `docs/02-architecture/network-and-data.md`):
 * `tấn công = 2 × sức mạnh + cấp`, `phòng thủ = nhanh nhẹn / 2` (làm tròn xuống),
 * `tốc độ = nhanh nhẹn + cấp` (tốc độ quyết định thứ tự lượt trong trận).
 */
export function resolveStats(definition: ClassDefinitionStats, level: number): ResolvedStats {
  const base = statsAtLevel(definition.baseStats, definition.perLevel, level);
  return {
    strength: base.strength,
    agility: base.agility,
    spirit: base.spirit,
    maxHp: base.hp,
    maxMp: base.mp,
    attack: ATTACK_PER_STRENGTH * base.strength + level,
    defense: defenseFromAgility(base.agility),
    speed: base.agility + level,
  };
}

/** Phần của `ClassDefinition` mà phần tính chỉ số cần (tránh phụ thuộc cả schema). */
export type ClassDefinitionStats = {
  baseStats: { strength: number; agility: number; spirit: number; hp: number; mp: number };
  perLevel: { strength: number; agility: number; spirit: number; hp: number; mp: number };
};

/** Chỉ số của một nhân vật theo hàng trong database (gộp cả nhánh thiếu dữ liệu phái). */
export function resolvedFor(
  data: GameData,
  record: Pick<CharacterRecord, 'school' | 'level'>,
): ResolvedStats {
  return resolveStats(data.classes.get(record.school) ?? FALLBACK_CLASS, record.level);
}

/** Máu hiện tại: `null` trong database nghĩa là **đang đầy** (xem `server/src/db/schema.ts`). */
export function currentHp(record: { readonly hp: number | null }, maxHp: number): number {
  return record.hp === null ? maxHp : Math.min(maxHp, Math.max(1, record.hp));
}

/** Nội lực hiện tại; cùng quy ước `null` là đầy với máu. */
export function currentMp(record: { readonly mp: number | null }, maxMp: number): number {
  return record.mp === null ? maxMp : Math.min(maxMp, Math.max(0, record.mp));
}

/** Chiêu chủ động của một nhân vật, đã xếp theo cấp học. */
export function skillsOf(data: GameData, character: Pick<Character, 'class' | 'level'>): Skill[] {
  return learnedSkills(data.skills.values(), character.class, character.level);
}

/**
 * Gói `S2C_CHARACTER`: đủ dữ liệu để HUD vẽ máu/nội lực/kinh nghiệm và để client biết chiêu nào
 * đang có. `hp`/`mp` ở đây là **giá trị hiện tại** (truyền vào), phần còn lại suy từ cấp.
 */
export function characterStatsPayload(options: {
  record: CharacterRecord;
  data: GameData;
  /** Bỏ trống thì lấy máu/nội lực đang có trong database. */
  hp?: number;
  mp?: number;
}): CharacterStats {
  const { record, data } = options;
  const resolved = resolvedFor(data, record);
  const hp = options.hp ?? currentHp(record, resolved.maxHp);
  const mp = options.mp ?? currentMp(record, resolved.maxMp);
  return {
    id: record.id,
    name: record.name,
    school: record.school,
    class: record.class,
    level: record.level,
    exp: record.exp,
    expToNext: expToNextLevel(record.level),
    yen: record.yen,
    hp,
    maxHp: resolved.maxHp,
    mp,
    maxMp: resolved.maxMp,
    strength: resolved.strength,
    agility: resolved.agility,
    spirit: resolved.spirit,
    attack: resolved.attack,
    defense: resolved.defense,
    speed: resolved.speed,
    skills: skillsOf(data, record).map((skill): BattleSkill => ({
      skillId: skill.id,
      name: skill.name,
      costMp: skill.costMp,
      cooldownTurns: skillCooldownTurns(skill.cooldownMs),
      levelRequired: skill.levelRequired,
    })),
  };
}

/**
 * Chỉ số dùng khi game-data thiếu file của phái (không thể xảy ra: `checkGameData` bắt buộc mọi
 * trường đều có file). Có nhánh này để hàm thuần không phải ném lỗi giữa đường.
 */
const FALLBACK_CLASS: ClassDefinitionStats = {
  baseStats: { strength: 1, agility: 1, spirit: 1, hp: 1, mp: 0 },
  perLevel: { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 },
};

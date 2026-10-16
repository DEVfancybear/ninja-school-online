import { DEFENSE_PER_AGILITY } from './battle.js';
import type { CharacterClass } from './game.js';

/**
 * Chỉ số gốc của một phái. Cùng một kiểu dùng cho cả chỉ số ở cấp 1 (`baseStats`) lẫn phần tăng
 * thêm mỗi cấp (`perLevel`) trong `game-data/classes/*.json`.
 */
export interface StatBlock {
  readonly strength: number;
  readonly agility: number;
  readonly spirit: number;
  readonly hp: number;
  readonly mp: number;
}

/** Chỉ số ở một cấp: chỉ số gốc cộng phần tăng của (cấp − 1) lần lên cấp. */
export function statsAtLevel(base: StatBlock, perLevel: StatBlock, level: number): StatBlock {
  const steps = Math.max(0, Math.trunc(level) - 1);
  return {
    strength: base.strength + perLevel.strength * steps,
    agility: base.agility + perLevel.agility * steps,
    spirit: base.spirit + perLevel.spirit * steps,
    hp: base.hp + perLevel.hp * steps,
    mp: base.mp + perLevel.mp * steps,
  };
}

/** Phòng thủ của người chơi suy từ nhanh nhẹn; quái dùng thẳng số trong `game-data/monsters/`. */
export function defenseFromAgility(agility: number): number {
  return Math.floor(agility * DEFENSE_PER_AGILITY);
}

/** Phần tối thiểu của một chiêu để tính "đã học được chưa". */
export interface SkillRequirement {
  readonly id: string;
  readonly class: CharacterClass;
  readonly type: 'active' | 'passive';
  readonly levelRequired: number;
}

/**
 * Chiêu **chủ động** mà một nhân vật đã học: đúng phái, đủ cấp. Không có bảng "chiêu đã học" riêng
 * — học chiêu là hàm của phái và cấp, nên dữ liệu chiêu là nguồn sự thật duy nhất.
 */
export function learnedSkills<T extends SkillRequirement>(
  skills: Iterable<T>,
  characterClass: CharacterClass,
  level: number,
): T[] {
  return [...skills]
    .filter(
      (skill) =>
        skill.class === characterClass && skill.type === 'active' && skill.levelRequired <= level,
    )
    .sort((a, b) => a.levelRequired - b.levelRequired || a.id.localeCompare(b.id));
}

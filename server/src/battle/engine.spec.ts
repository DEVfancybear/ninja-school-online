import { describe, expect, it } from 'vitest';
import { CRITICAL_MULTIPLIER, MIN_DAMAGE, type Skill } from '@ninja/shared';
import {
  cooldownTurnsFor,
  fleeChance,
  isAlive,
  normalAttackBase,
  readyInTurns,
  rollHit,
  skillBase,
  turnOrder,
  type Combatant,
} from './engine.js';

/** Chuỗi số giả để mọi phép tính ngẫu nhiên thành xác định. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length]!;
    index += 1;
    return value;
  };
}

function combatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'c1',
    kind: 'player',
    name: 'Nhẫn Giả',
    level: 1,
    maxHp: 60,
    maxMp: 40,
    hp: 60,
    mp: 40,
    attack: 13,
    defense: 3,
    speed: 6,
    stats: { strength: 6, agility: 5, spirit: 4 },
    skills: [],
    cooldownUntil: new Map(),
    ...overrides,
  };
}

const skill: Skill = {
  id: 'skill-tram-co-ban',
  name: 'Trảm Cơ Bản',
  school: 'haruna',
  class: 'dao',
  type: 'active',
  levelRequired: 1,
  costMp: 5,
  cooldownMs: 0,
  targets: 1,
  power: 10,
  scale: { stat: 'strength', factor: 1.2 },
  effects: [],
};

describe('sát thương', () => {
  it('đòn đánh thường = power + hệ số × sức tấn công', () => {
    expect(normalAttackBase(13)).toBe(15);
  });

  it('chiêu ăn theo chỉ số mà chiêu khai báo', () => {
    expect(skillBase(skill, combatant())).toBeCloseTo(10 + 1.2 * 6, 5);
  });

  it('dao động ±10% quanh giá trị gốc', () => {
    const attacker = combatant();
    const target = combatant({ defense: 0 });
    // Hai lần rút: lần đầu là chí mạng (0.99 ≥ 0.05 → không), lần sau là dao động (1 → +10%).
    const high = rollHit(target, normalAttackBase(attacker.attack), sequence([0.99, 1]));
    const low = rollHit(target, normalAttackBase(attacker.attack), sequence([0.99, 0]));
    expect(high.damage).toBe(Math.round(15 * 1.1));
    expect(low.damage).toBe(Math.round(15 * 0.9));
  });

  it('chí mạng nhân thêm hệ số chí mạng', () => {
    const target = combatant({ defense: 0 });
    const hit = rollHit(target, 20, sequence([0, 0.5]));
    expect(hit.critical).toBe(true);
    expect(hit.damage).toBe(Math.round(20 * CRITICAL_MULTIPLIER));
  });

  it('trừ phòng thủ của mục tiêu nhưng không bao giờ dưới sát thương tối thiểu', () => {
    const tank = combatant({ defense: 999 });
    const hit = rollHit(tank, 15, sequence([0.99, 0.5]));
    expect(hit.damage).toBe(MIN_DAMAGE);
  });
});

describe('thứ tự lượt', () => {
  it('xếp theo tốc độ giảm dần', () => {
    const fast = combatant({ id: 'fast', speed: 20 });
    const slow = combatant({ id: 'slow', speed: 2 });
    expect(turnOrder([slow, fast], sequence([0.5]))).toEqual(['fast', 'slow']);
  });

  it('tốc độ bằng nhau thì thứ tự do ngẫu nhiên quyết định', () => {
    const a = combatant({ id: 'a', speed: 10 });
    const b = combatant({ id: 'b', speed: 10 });
    expect(turnOrder([a, b], sequence([0.1, 0.9]))).toEqual(['a', 'b']);
    expect(turnOrder([a, b], sequence([0.9, 0.1]))).toEqual(['b', 'a']);
  });

  it('người đã gục không có lượt', () => {
    const dead = combatant({ id: 'dead', speed: 99, hp: 0 });
    expect(turnOrder([dead, combatant({ id: 'alive', speed: 1 })], sequence([0.5]))).toEqual([
      'alive',
    ]);
    expect(isAlive(dead)).toBe(false);
  });
});

describe('chạy thoát', () => {
  it('nhanh hơn đối thủ thì dễ chạy hơn, nhưng luôn bị kẹp trong khoảng cho phép', () => {
    const equal = fleeChance(7, 7);
    const faster = fleeChance(50, 1);
    const slower = fleeChance(1, 50);
    expect(equal).toBeCloseTo(0.5, 5);
    expect(faster).toBeLessThan(1);
    expect(slower).toBeGreaterThan(0);
    expect(faster).toBeGreaterThan(equal);
    expect(slower).toBeLessThan(equal);
  });
});

describe('hồi chiêu', () => {
  it('chiêu không hồi chiêu dùng được ngay', () => {
    expect(cooldownTurnsFor(skill)).toBe(0);
    expect(readyInTurns(combatant(), skill.id, 1)).toBe(0);
  });

  it('chiêu hồi chiêu được quy đổi ra số vòng và đếm lùi theo vòng', () => {
    const slowSkill: Skill = { ...skill, id: 'skill-tram-cuong-phong', cooldownMs: 60_000 };
    expect(cooldownTurnsFor(slowSkill)).toBe(2);
    const actor = combatant({ cooldownUntil: new Map([[slowSkill.id, 3]]) });
    expect(readyInTurns(actor, slowSkill.id, 1)).toBe(2);
    expect(readyInTurns(actor, slowSkill.id, 3)).toBe(0);
  });
});

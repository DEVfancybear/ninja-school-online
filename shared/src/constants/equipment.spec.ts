import { describe, expect, it } from 'vitest';
import {
  SELL_PRICE_RATIO,
  UPGRADE_MAX_LEVEL,
  UPGRADE_MATERIAL_ID,
  UPGRADE_YEN_COST,
  sellPrice,
  statAtUpgradeLevel,
  statsAtUpgradeLevel,
  sumStats,
  upgradeMaxLevelOf,
  upgradeSuccessRate,
  upgradeYenCost,
} from './equipment.js';

describe('sellPrice', () => {
  it('là 40% giá gốc, làm tròn xuống', () => {
    expect(SELL_PRICE_RATIO).toBe(0.4);
    expect(sellPrice(150)).toBe(60);
    expect(sellPrice(25)).toBe(10);
  });

  it('không bao giờ trả 0 yên cho món có giá', () => {
    expect(sellPrice(1)).toBe(1);
    expect(sellPrice(0)).toBe(1);
  });
});

describe('upgradeSuccessRate', () => {
  it('cấp 0 → 1 chắc chắn thành công, rồi khó dần', () => {
    expect(upgradeSuccessRate(0)).toBe(1);
    expect(upgradeSuccessRate(1)).toBe(0.9);
    expect(upgradeSuccessRate(UPGRADE_MAX_LEVEL - 1)).toBeGreaterThan(0);
  });

  it('đã chạm trần thì tỉ lệ là 0 (không thử được nữa)', () => {
    expect(upgradeSuccessRate(UPGRADE_MAX_LEVEL)).toBe(0);
  });
});

describe('upgradeYenCost', () => {
  it('tăng dần theo cấp hiện tại và chạm trần thì bằng 0', () => {
    for (let level = 1; level < UPGRADE_MAX_LEVEL; level += 1) {
      expect(upgradeYenCost(level)).toBeGreaterThan(upgradeYenCost(level - 1) ?? 0);
    }
    expect(upgradeYenCost(UPGRADE_MAX_LEVEL)).toBe(0);
    expect(UPGRADE_YEN_COST[0]).toBeGreaterThan(0);
  });
});

describe('upgradeMaxLevelOf', () => {
  it('lấy số nhỏ hơn giữa trần chung và cấp của món', () => {
    expect(upgradeMaxLevelOf(5)).toBe(UPGRADE_MAX_LEVEL);
    expect(upgradeMaxLevelOf(3)).toBe(3);
    expect(upgradeMaxLevelOf(0)).toBe(0);
  });
});

describe('statsAtUpgradeLevel', () => {
  it('mỗi cấp cộng thêm 20% chỉ số gốc, làm tròn lên', () => {
    // Kiếm Gỗ: sức mạnh 2 → +1 mỗi cấp cường hóa.
    expect(statAtUpgradeLevel(2, 0)).toBe(2);
    expect(statAtUpgradeLevel(2, 1)).toBe(3);
    expect(statAtUpgradeLevel(2, 5)).toBe(4);
    // Áo Vải: máu 20 → +4 mỗi cấp.
    expect(statAtUpgradeLevel(20, 1)).toBe(24);
  });

  it('chỉ số bằng 0 thì cường hóa vẫn là 0', () => {
    const stats = statsAtUpgradeLevel({ strength: 2, agility: 0, spirit: 0, hp: 20, mp: 0 }, 1);
    expect(stats).toEqual({ strength: 3, agility: 0, spirit: 0, hp: 24, mp: 0 });
  });
});

describe('sumStats', () => {
  it('cộng dồn chỉ số của nhiều món đang mặc', () => {
    const total = sumStats([
      { strength: 2, agility: 0, spirit: 0, hp: 0, mp: 0 },
      { strength: 0, agility: 1, spirit: 0, hp: 20, mp: 0 },
    ]);
    expect(total).toEqual({ strength: 2, agility: 1, spirit: 0, hp: 20, mp: 0 });
  });

  it('không có món nào thì ra khối 0', () => {
    expect(sumStats([])).toEqual({ strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 });
  });
});

describe('UPGRADE_MATERIAL_ID', () => {
  it('là đá vụn rơi ra từ quái', () => {
    expect(UPGRADE_MATERIAL_ID).toBe('item-da-vun');
  });
});

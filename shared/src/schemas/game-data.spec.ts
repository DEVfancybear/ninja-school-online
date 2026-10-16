import { describe, expect, it } from 'vitest';
import { ItemSchema, SkillSchema, SCHOOL_CLASSES } from '../index.js';

const validSkill = {
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
};

describe('SkillSchema', () => {
  it('chấp nhận chiêu thức hợp lệ', () => {
    expect(SkillSchema.parse(validSkill).effects).toEqual([]);
  });

  it('từ chối chiêu thức dùng phái không thuộc trường đã chọn', () => {
    expect(SCHOOL_CLASSES.haruna).not.toContain('kunai');
  });

  it('từ chối id sai định dạng', () => {
    expect(() => SkillSchema.parse({ ...validSkill, id: 'sai-id' })).toThrow();
  });

  it('từ chối costMp âm', () => {
    expect(() => SkillSchema.parse({ ...validSkill, costMp: -1 })).toThrow();
  });
});

describe('ItemSchema', () => {
  it('điền giá trị mặc định cho vật phẩm tối thiểu', () => {
    const item = ItemSchema.parse({
      id: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      kind: 'weapon',
      slot: 'weapon',
      levelRequired: 1,
      price: 100,
    });
    expect(item.stats.hp).toBe(0);
    expect(item.upgradeMaxLevel).toBe(0);
  });

  it('từ chối trang bị không có ô mặc', () => {
    expect(() =>
      ItemSchema.parse({
        id: 'item-kiem-go',
        name: 'Kiếm Gỗ',
        kind: 'weapon',
        levelRequired: 1,
        price: 100,
      }),
    ).toThrow();
  });

  it('từ chối vật phẩm không mặc được nhưng lại có ô mặc', () => {
    expect(() =>
      ItemSchema.parse({
        id: 'item-da-vun',
        name: 'Đá Vụn',
        kind: 'material',
        slot: 'weapon',
        levelRequired: 1,
        price: 5,
      }),
    ).toThrow();
  });

  it('từ chối giá âm', () => {
    expect(() =>
      ItemSchema.parse({
        id: 'item-kiem-go',
        name: 'Kiếm Gỗ',
        kind: 'weapon',
        slot: 'weapon',
        levelRequired: 1,
        price: -5,
      }),
    ).toThrow();
  });
});

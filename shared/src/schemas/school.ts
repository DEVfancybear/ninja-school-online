import { z } from 'zod';
import { SCHOOLS } from '../constants/game.js';
import type { StatBlock } from '../constants/stats.js';

/**
 * Chỉ số dùng chung cho chỉ số gốc và phần tăng mỗi cấp. Kiểu ghi tường minh là `StatBlock` để
 * `shared/src/constants/stats.ts` là nguồn duy nhất khai báo hình dạng chỉ số.
 */
export const StatBlockSchema: z.ZodType<StatBlock> = z.object({
  strength: z.number().int().min(0).max(9999),
  agility: z.number().int().min(0).max(9999),
  spirit: z.number().int().min(0).max(9999),
  hp: z.number().int().min(0).max(999999),
  mp: z.number().int().min(0).max(999999),
});

/** Một phái trong `game-data/classes/*.json`: hệ số chỉ số theo cấp và đồ khởi đầu. */
export const ClassDefinitionSchema = z
  .object({
    school: z.enum(SCHOOLS),
    name: z.string().min(1),
    baseStats: StatBlockSchema,
    perLevel: StatBlockSchema,
    startingYen: z.number().int().min(0).max(1000000).default(0),
    /** Vật phẩm nhận ngay khi tạo nhân vật; phải có file trong `game-data/items/`. */
    startingItems: z
      .array(
        z.object({
          itemId: z.string().regex(/^item-[a-z0-9-]+$/),
          qty: z.number().int().min(1).max(99),
        }),
      )
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.baseStats.hp < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseStats', 'hp'],
        message: 'máu ở cấp 1 phải lớn hơn 0',
      });
    }
  });

export type ClassDefinition = z.infer<typeof ClassDefinitionSchema>;

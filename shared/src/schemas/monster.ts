import { z } from 'zod';

/**
 * Hình dáng quái để client vẽ bằng hình khối (dự án không dùng tài nguyên hình). Dữ liệu quái chọn
 * hình, không chọn cách vẽ: client tự biết vẽ "bù nhìn", "chuột" hay "thú" từ mã nguồn.
 */
export const MONSTER_SHAPES = ['scarecrow', 'rodent', 'beast'] as const;
export type MonsterShape = (typeof MONSTER_SHAPES)[number];

/** Một món quái có thể rơi: xác suất trong [0, 1] và số lượng ngẫu nhiên trong [minQty, maxQty]. */
export const MonsterDropSchema = z
  .object({
    itemId: z.string().regex(/^item-[a-z0-9-]+$/),
    chance: z.number().min(0).max(1),
    minQty: z.number().int().min(1).max(99).default(1),
    maxQty: z.number().int().min(1).max(99).default(1),
  })
  .superRefine((drop, ctx) => {
    if (drop.minQty > drop.maxQty) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxQty'],
        message: 'maxQty phải lớn hơn hoặc bằng minQty',
      });
    }
  });

/**
 * Một loại quái trong `game-data/monsters/*.json`. Quái ở M3 chỉ đánh thường: mọi chiêu của quái là
 * "đòn đánh thường" với chỉ số tấn công của chính nó, nên dữ liệu không cần bảng chiêu riêng.
 */
export const MonsterSchema = z
  .object({
    id: z.string().regex(/^mob-[a-z0-9-]+$/, 'id quái phải có dạng mob-ten-quai'),
    name: z.string().min(1),
    shape: z.enum(MONSTER_SHAPES),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, 'màu phải ở dạng #rrggbb'),
    level: z.number().int().min(1).max(100),
    maxHp: z.number().int().min(1).max(1000000),
    attack: z.number().int().min(0).max(9999),
    defense: z.number().int().min(0).max(9999),
    speed: z.number().int().min(0).max(9999),
    expReward: z.number().int().min(0).max(1000000),
    yenMin: z.number().int().min(0).max(1000000),
    yenMax: z.number().int().min(0).max(1000000),
    drops: z.array(MonsterDropSchema).max(8).default([]),
    /** Thời gian quái sống lại sau khi bị hạ; `0` nghĩa là không sống lại. */
    respawnMs: z.number().int().min(0).max(600000).default(30000),
  })
  .superRefine((monster, ctx) => {
    if (monster.yenMin > monster.yenMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['yenMax'],
        message: 'yenMax phải lớn hơn hoặc bằng yenMin',
      });
    }
  });

export type Monster = z.infer<typeof MonsterSchema>;
export type MonsterDrop = z.infer<typeof MonsterDropSchema>;

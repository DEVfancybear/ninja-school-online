import { z } from 'zod';

/** Loại vật phẩm. Chỉ `consumable` là dùng được ngay trong túi ở M3. */
export const ITEM_KINDS = ['weapon', 'armor', 'accessory', 'consumable', 'material'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Hiệu ứng của vật phẩm dùng được: hồi máu và/hoặc hồi nội lực. */
export const ConsumableSchema = z
  .object({
    healHp: z.number().int().min(0).max(999999).default(0),
    healMp: z.number().int().min(0).max(999999).default(0),
  })
  .superRefine((effect, ctx) => {
    if (effect.healHp === 0 && effect.healMp === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'vật phẩm dùng được phải hồi máu hoặc hồi nội lực',
      });
    }
  });

/** Một vật phẩm trong game-data/items/*.json. */
export const ItemSchema = z
  .object({
    id: z.string().regex(/^item-[a-z0-9-]+$/),
    name: z.string().min(1),
    kind: z.enum(ITEM_KINDS),
    slot: z.enum(['weapon', 'body', 'head', 'accessory']).nullable().default(null),
    levelRequired: z.number().int().min(1).max(100),
    price: z.number().int().min(0),
    stats: z
      .object({
        strength: z.number().int().default(0),
        agility: z.number().int().default(0),
        spirit: z.number().int().default(0),
        hp: z.number().int().default(0),
        mp: z.number().int().default(0),
      })
      .default({ strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 }),
    /** Chỉ vật phẩm loại `consumable` mới có hiệu ứng; các loại khác để `null`. */
    consumable: ConsumableSchema.nullable().default(null),
    upgradeMaxLevel: z.number().int().min(0).default(0),
    description: z.string().default(''),
  })
  .superRefine((item, ctx) => {
    if (item.kind === 'consumable' && item.consumable === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['consumable'],
        message: 'vật phẩm loại consumable phải có hiệu ứng hồi máu hoặc hồi nội lực',
      });
    }
    if (item.kind !== 'consumable' && item.consumable !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['consumable'],
        message: 'chỉ vật phẩm loại consumable mới có hiệu ứng dùng được',
      });
    }
  });

export type Item = z.infer<typeof ItemSchema>;

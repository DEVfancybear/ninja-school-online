import { z } from 'zod';

/** Một vật phẩm trong game-data/items/*.json. */
export const ItemSchema = z.object({
  id: z.string().regex(/^item-[a-z0-9-]+$/),
  name: z.string().min(1),
  kind: z.enum(['weapon', 'armor', 'accessory', 'consumable', 'material']),
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
  upgradeMaxLevel: z.number().int().min(0).default(0),
  description: z.string().default(''),
});
export type Item = z.infer<typeof ItemSchema>;

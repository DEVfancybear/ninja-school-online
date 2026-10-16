import { z } from 'zod';
import { EQUIP_SLOTS } from '../constants/equipment.js';

/** Loại vật phẩm. `weapon`, `armor` và `accessory` là trang bị mặc được; `consumable` dùng được. */
export const ITEM_KINDS = ['weapon', 'armor', 'accessory', 'consumable', 'material'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Loại mặc được; các loại còn lại phải để `slot` là `null`. */
export const EQUIPPABLE_KINDS: readonly ItemKind[] = ['weapon', 'armor', 'accessory'];

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
    slot: z.enum(EQUIP_SLOTS).nullable().default(null),
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

    // Loại và ô mặc phải khớp nhau: server dựa vào đây để biết món nào mặc vào ô nào.
    const equippable = EQUIPPABLE_KINDS.includes(item.kind);
    if (equippable && item.slot === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['slot'],
        message: `vật phẩm loại ${item.kind} phải có ô mặc (slot)`,
      });
    }
    if (!equippable && item.slot !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['slot'],
        message: 'chỉ trang bị mới có ô mặc (slot)',
      });
    }
    if (item.kind === 'weapon' && item.slot !== null && item.slot !== 'weapon') {
      ctx.addIssue({ code: 'custom', path: ['slot'], message: 'vũ khí chỉ mặc được ở ô weapon' });
    }
    if (
      item.kind === 'armor' &&
      item.slot !== null &&
      item.slot !== 'body' &&
      item.slot !== 'head'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['slot'],
        message: 'áo giáp chỉ mặc được ở ô body hoặc head',
      });
    }
    if (item.kind === 'accessory' && item.slot !== null && item.slot !== 'accessory') {
      ctx.addIssue({
        code: 'custom',
        path: ['slot'],
        message: 'phụ kiện chỉ mặc được ở ô accessory',
      });
    }
    if (item.upgradeMaxLevel > 0 && !equippable) {
      ctx.addIssue({
        code: 'custom',
        path: ['upgradeMaxLevel'],
        message: 'chỉ trang bị mới cường hóa được',
      });
    }
  });

export type Item = z.infer<typeof ItemSchema>;

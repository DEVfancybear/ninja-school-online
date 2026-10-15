import { z } from 'zod';
import { CLASSES, SCHOOLS } from '../constants/game.js';

/** Hiệu ứng phụ của một chiêu thức. */
export const SkillEffectSchema = z.object({
  kind: z.enum(['poison', 'stun', 'heal', 'buff', 'debuff']),
  chance: z.number().min(0).max(1),
  turns: z.number().int().min(1).max(10),
  value: z.number(),
});

/** Một chiêu thức trong game-data/skills/*.json. */
export const SkillSchema = z.object({
  id: z.string().regex(/^skill-[a-z0-9-]+$/),
  name: z.string().min(1),
  school: z.enum(SCHOOLS),
  class: z.enum(CLASSES),
  type: z.enum(['active', 'passive']),
  levelRequired: z.number().int().min(1).max(100),
  costMp: z.number().int().min(0),
  cooldownMs: z.number().int().min(0),
  targets: z.number().int().min(1).max(8),
  power: z.number().min(0),
  scale: z.object({ stat: z.enum(['strength', 'agility', 'spirit']), factor: z.number().min(0) }),
  effects: z.array(SkillEffectSchema).default([]),
});
export type Skill = z.infer<typeof SkillSchema>;

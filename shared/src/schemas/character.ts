import { z } from 'zod';
import { CLASSES, SCHOOLS, SCHOOL_CLASSES } from '../constants/game.js';
import {
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_NAME_MIN_LENGTH,
  CHARACTER_NAME_PATTERN,
} from '../constants/character.js';

export const CharacterNameSchema = z
  .string()
  .min(CHARACTER_NAME_MIN_LENGTH, `tên nhân vật phải có ít nhất ${CHARACTER_NAME_MIN_LENGTH} ký tự`)
  .max(CHARACTER_NAME_MAX_LENGTH, `tên nhân vật tối đa ${CHARACTER_NAME_MAX_LENGTH} ký tự`)
  .regex(CHARACTER_NAME_PATTERN, 'tên nhân vật chỉ gồm chữ cái và chữ số, không có dấu cách');

export const CreateCharacterRequestSchema = z
  .object({
    name: CharacterNameSchema,
    school: z.enum(SCHOOLS, { error: 'trường không hợp lệ' }),
    class: z.enum(CLASSES, { error: 'phái không hợp lệ' }),
  })
  .superRefine((value, ctx) => {
    const allowed = SCHOOL_CLASSES[value.school];
    if (!allowed.includes(value.class)) {
      ctx.addIssue({
        code: 'custom',
        path: ['class'],
        message: `trường ${value.school} chỉ đào tạo phái ${allowed.join(', ')}`,
      });
    }
  });
export type CreateCharacterRequest = z.infer<typeof CreateCharacterRequestSchema>;

/** Nhân vật ở góc nhìn client. */
export const CharacterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  school: z.enum(SCHOOLS),
  class: z.enum(CLASSES),
  level: z.number().int().min(1),
  exp: z.number().int().min(0),
  yen: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const CharacterListResponseSchema = z.object({ characters: z.array(CharacterSchema) });
export type CharacterListResponse = z.infer<typeof CharacterListResponseSchema>;

export const CharacterResponseSchema = z.object({ character: CharacterSchema });
export type CharacterResponse = z.infer<typeof CharacterResponseSchema>;

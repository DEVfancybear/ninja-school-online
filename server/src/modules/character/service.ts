import { eq, sql } from 'drizzle-orm';
import {
  MAX_CHARACTERS_PER_ACCOUNT,
  type Character,
  type CreateCharacterRequest,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characters } from '../../db/schema.js';
import { conflictError } from '../../errors.js';
import { isUniqueViolation } from '../account/service.js';

type CharacterRow = typeof characters.$inferSelect;

/** Chuyển hàng trong DB thành dữ liệu trả cho client. */
export function toCharacterDto(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    school: row.school as Character['school'],
    class: row.class as Character['class'],
    level: row.level,
    exp: row.exp,
    yen: row.yen,
    createdAt: row.createdAt.toISOString(),
  };
}

export class CharacterService {
  constructor(private readonly db: Db) {}

  /** Danh sách nhân vật của một tài khoản, mới tạo trước. */
  async list(accountId: string): Promise<Character[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .orderBy(sql`${characters.createdAt} desc, ${characters.name} asc`);
    return rows.map(toCharacterDto);
  }

  /** Tạo nhân vật mới, kiểm tra giới hạn số lượng và trùng tên (không phân biệt hoa thường). */
  async create(accountId: string, input: CreateCharacterRequest): Promise<Character> {
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(characters)
      .where(eq(characters.accountId, accountId));

    if (total >= MAX_CHARACTERS_PER_ACCOUNT) {
      throw conflictError(
        `mỗi tài khoản chỉ được có tối đa ${MAX_CHARACTERS_PER_ACCOUNT} nhân vật`,
      );
    }

    try {
      const inserted = await this.db
        .insert(characters)
        .values({
          accountId,
          name: input.name,
          school: input.school,
          class: input.class,
        })
        .returning();
      return toCharacterDto(inserted[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflictError('tên nhân vật này đã có người dùng, hãy chọn tên khác');
      }
      throw error;
    }
  }
}

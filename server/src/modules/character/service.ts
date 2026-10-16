import { and, eq, sql } from 'drizzle-orm';
import {
  MAX_CHARACTERS_PER_ACCOUNT,
  type Character,
  type CreateCharacterRequest,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characters, type CharacterRow } from '../../db/schema.js';
import { conflictError } from '../../errors.js';
import type { GameData } from '../../world/game-data.js';
import { isUniqueViolation } from '../account/service.js';
import type { InventoryService } from '../inventory/service.js';
import type { CharacterRecord } from './stats.js';

/** Chuyển hàng trong DB thành dữ liệu kèm máu/nội lực, dùng cho chiến đấu (không gửi qua REST). */
export function toCharacterRecord(row: CharacterRow): CharacterRecord {
  return { ...toCharacterDto(row), hp: row.hp, mp: row.mp };
}

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
  constructor(
    private readonly db: Db,
    private readonly inventory: InventoryService,
    private readonly gameData: GameData,
  ) {}

  /** Danh sách nhân vật của một tài khoản, mới tạo trước. */
  async list(accountId: string): Promise<Character[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .orderBy(sql`${characters.createdAt} desc, ${characters.name} asc`);
    return rows.map(toCharacterDto);
  }

  /**
   * Chọn nhân vật để vào thế giới (WebSocket): theo `characterId` nếu client chỉ định — phải thuộc
   * tài khoản — hoặc nhân vật **tạo gần nhất** khi bỏ trống.
   *
   * Trả `undefined` khi không tìm thấy; người gọi tự phân biệt "id sai" và "tài khoản chưa có
   * nhân vật" dựa trên việc client có gửi `characterId` hay không.
   */
  async pickForWorld(accountId: string, characterId?: string): Promise<Character | undefined> {
    const [row] = await this.db
      .select()
      .from(characters)
      .where(
        characterId
          ? and(eq(characters.accountId, accountId), eq(characters.id, characterId))
          : eq(characters.accountId, accountId),
      )
      .orderBy(sql`${characters.createdAt} desc, ${characters.name} asc`)
      .limit(1);
    return row ? toCharacterDto(row) : undefined;
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
      // Đồ và yên khởi đầu lấy từ `game-data/classes/`: đổi quà tân thủ không cần sửa mã nguồn.
      const definition = this.gameData.classes.get(input.school);
      const inserted = await this.db
        .insert(characters)
        .values({
          accountId,
          name: input.name,
          school: input.school,
          class: input.class,
          yen: definition?.startingYen ?? 0,
        })
        .returning();

      const character = toCharacterDto(inserted[0]!);
      if (definition) {
        await this.inventory.grantItems(character.id, definition.startingItems);
      }
      return character;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflictError('tên nhân vật này đã có người dùng, hãy chọn tên khác');
      }
      throw error;
    }
  }

  /** Nhân vật kèm máu/nội lực — dùng khi vào trận và khi hồi sinh. */
  async findById(characterId: string): Promise<CharacterRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return row ? toCharacterRecord(row) : undefined;
  }

  /** Ghi máu/nội lực hiện tại sau trận đấu. Giá trị đã được kẹp trong khoảng hợp lệ ở tầng trận đấu. */
  async updateVitals(characterId: string, hp: number, mp: number): Promise<void> {
    await this.db
      .update(characters)
      .set({ hp, mp, updatedAt: sql`now()` })
      .where(eq(characters.id, characterId));
  }

  /** Ghi cấp/kinh nghiệm/yên sau khi nhận thưởng trận đấu (hoặc mất yên khi thua). */
  async updateProgress(
    characterId: string,
    values: { readonly level: number; readonly exp: number; readonly yen: number },
  ): Promise<void> {
    await this.db
      .update(characters)
      .set({ level: values.level, exp: values.exp, yen: values.yen, updatedAt: sql`now()` })
      .where(eq(characters.id, characterId));
  }
}

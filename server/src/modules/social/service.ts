import { and, asc, eq, inArray, or } from 'drizzle-orm';
import {
  ErrorCode,
  MAX_FRIENDS,
  Opcode,
  type Character,
  type SocialPerson,
  type SocialUpdate,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characters, friendships } from '../../db/schema.js';
import type { SessionRegistry } from '../../net/session-registry.js';
import type { CharacterService } from '../character/service.js';

/**
 * Kết quả một lệnh xã hội. Mọi lý do từ chối có **mã riêng** để client nói đúng nguyên nhân, còn
 * câu tiếng Việt chỉ để hiển thị.
 */
export type SocialResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/** Câu lỗi dùng chung: tên nhân vật không có thật, gửi cho cả kết bạn và chat riêng. */
export function characterNotFound(rawName: string): SocialResult {
  return {
    ok: false,
    code: ErrorCode.CHARACTER_NOT_FOUND,
    message: `Không tìm thấy nhân vật "${rawName.trim()}".`,
  };
}

function fail(code: ErrorCode, message: string): SocialResult {
  return { ok: false, code, message };
}

/** Dựng một dòng của `SocialUpdate` từ hàng `characters` và trạng thái online hiện tại. */
function toPerson(character: Character, online: boolean): SocialPerson {
  return {
    name: character.name,
    level: character.level,
    school: character.school,
    class: character.class,
    online,
  };
}

/** Sắp theo tên: thứ tự ổn định giữa các lần đẩy gói, không phụ thuộc thứ tự hàng trong database. */
function byName(people: readonly SocialPerson[]): SocialPerson[] {
  return [...people].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/**
 * Bạn bè (M6). Tên nhân vật là **địa chỉ**: mọi lệnh nhận tên, so không phân biệt hoa/thường và cắt
 * khoảng trắng hai đầu.
 *
 * Bạn bè là quan hệ **hai chiều** nhưng lưu **một hàng cho một cặp** (có hướng mời), xem
 * `server/src/db/schema.ts`. Nhờ vậy mời lại người đã mời mình chỉ là đổi `status` của hàng đang có.
 *
 * Mọi thay đổi đều đẩy `S2C_SOCIAL_UPDATE` cho **cả hai** bên nếu đang online, nên không client nào
 * phải tự đoán danh sách của mình.
 */
export class SocialService {
  constructor(
    private readonly db: Db,
    private readonly characters: CharacterService,
    private readonly sessions: SessionRegistry,
  ) {}

  /** Toàn bộ trạng thái xã hội của một nhân vật. */
  async list(characterId: string): Promise<SocialUpdate> {
    const rows = await this.db
      .select({
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
      })
      .from(friendships)
      .where(
        or(eq(friendships.requesterId, characterId), eq(friendships.addresseeId, characterId)),
      );

    const friendIds: string[] = [];
    const incomingIds: string[] = [];
    const outgoingIds: string[] = [];
    for (const row of rows) {
      const otherId = row.requesterId === characterId ? row.addresseeId : row.requesterId;
      if (row.status === 'accepted') {
        friendIds.push(otherId);
      } else if (row.addresseeId === characterId) {
        incomingIds.push(row.requesterId);
      } else {
        outgoingIds.push(row.addresseeId);
      }
    }

    const people = await this.characters.findManyByIds([
      ...friendIds,
      ...incomingIds,
      ...outgoingIds,
    ]);
    const byId = new Map(people.map((character) => [character.id, character]));
    const render = (ids: readonly string[]): SocialPerson[] =>
      byName(
        ids
          .map((id) => byId.get(id))
          .filter((character) => character !== undefined)
          .map((character) => toPerson(character, this.isOnline(character.id))),
      );

    return {
      friends: render(friendIds),
      incoming: render(incomingIds),
      outgoing: render(outgoingIds),
      maxFriends: MAX_FRIENDS,
    };
  }

  /**
   * Gửi lời mời kết bạn. Người kia **đã mời mình** thì lệnh này là đồng ý: hàng đang chờ đổi sang
   * `accepted` chứ không sinh hàng thứ hai.
   */
  async request(characterId: string, rawName: string): Promise<SocialResult> {
    const target = await this.characters.findByName(rawName);
    if (!target) {
      return characterNotFound(rawName);
    }
    if (target.id === characterId) {
      return fail(ErrorCode.FRIEND_SELF, 'bạn không thể kết bạn với chính mình');
    }

    const existing = await this.findPair(characterId, target.id);
    if (existing?.status === 'accepted') {
      return fail(ErrorCode.FRIEND_ALREADY, `${target.name} đã có trong danh sách bạn của bạn`);
    }
    if (existing?.requesterId === characterId) {
      return fail(ErrorCode.FRIEND_ALREADY, `bạn đã gửi lời mời cho ${target.name} rồi`);
    }

    if (existing) {
      // Ngược chiều và đang chờ: lời mời này chính là đồng ý.
      const accepted = await this.acceptPair(characterId, target.id);
      if (!accepted.ok) {
        return accepted;
      }
      await this.pushTo(characterId, target.id);
      return { ok: true };
    }

    if ((await this.countFriends(characterId)) >= MAX_FRIENDS) {
      return fail(ErrorCode.FRIENDS_FULL, `danh sách bạn đã đủ ${MAX_FRIENDS} người`);
    }

    await this.db
      .insert(friendships)
      .values({ requesterId: characterId, addresseeId: target.id })
      .onConflictDoNothing();
    await this.pushTo(characterId, target.id);
    return { ok: true };
  }

  /** Đồng ý lời mời của một người. */
  async accept(characterId: string, rawName: string): Promise<SocialResult> {
    const target = await this.characters.findByName(rawName);
    if (!target) {
      return characterNotFound(rawName);
    }

    const existing = await this.findPair(characterId, target.id);
    if (existing?.status === 'accepted') {
      return fail(ErrorCode.FRIEND_ALREADY, `${target.name} đã có trong danh sách bạn của bạn`);
    }
    if (!existing || existing.requesterId !== target.id) {
      return fail(ErrorCode.FRIEND_NOT_FOUND, `${target.name} chưa gửi lời mời kết bạn cho bạn`);
    }

    const accepted = await this.acceptPair(characterId, target.id);
    if (!accepted.ok) {
      return accepted;
    }
    await this.pushTo(characterId, target.id);
    return { ok: true };
  }

  /** Từ chối lời mời của một người: xoá hàng đang chờ. */
  async decline(characterId: string, rawName: string): Promise<SocialResult> {
    const target = await this.characters.findByName(rawName);
    if (!target) {
      return characterNotFound(rawName);
    }

    const deleted = await this.db
      .delete(friendships)
      .where(
        and(
          eq(friendships.requesterId, target.id),
          eq(friendships.addresseeId, characterId),
          eq(friendships.status, 'pending'),
        ),
      )
      .returning({ id: friendships.id });
    if (deleted.length === 0) {
      return fail(ErrorCode.FRIEND_NOT_FOUND, `${target.name} chưa gửi lời mời kết bạn cho bạn`);
    }

    await this.pushTo(characterId, target.id);
    return { ok: true };
  }

  /** Bỏ một người khỏi danh sách bạn (hàng `accepted`, chiều nào cũng được). */
  async remove(characterId: string, rawName: string): Promise<SocialResult> {
    const target = await this.characters.findByName(rawName);
    if (!target) {
      return characterNotFound(rawName);
    }

    const deleted = await this.db
      .delete(friendships)
      .where(
        and(
          or(
            and(eq(friendships.requesterId, characterId), eq(friendships.addresseeId, target.id)),
            and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, characterId)),
          ),
          eq(friendships.status, 'accepted'),
        ),
      )
      .returning({ id: friendships.id });
    if (deleted.length === 0) {
      return fail(
        ErrorCode.FRIEND_NOT_FOUND,
        `${target.name} không có trong danh sách bạn của bạn`,
      );
    }

    await this.pushTo(characterId, target.id);
    return { ok: true };
  }

  /** Đẩy `S2C_SOCIAL_UPDATE` cho một nhân vật nếu đang online. */
  async push(characterId: string): Promise<void> {
    const session = this.sessions.get(characterId);
    if (!session) {
      return;
    }
    session.send(Opcode.S2C_SOCIAL_UPDATE, await this.list(characterId));
  }

  /**
   * Báo cho bạn bè biết mình vừa vào hoặc vừa ra (cờ `online` đổi). Gọi **sau** khi phiên đã đăng
   * ký (đăng nhập) hoặc đã gỡ (đăng xuất), để câu trả lời mang đúng trạng thái mới.
   */
  async announcePresence(characterId: string): Promise<void> {
    const rows = await this.db
      .select({
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(eq(friendships.requesterId, characterId), eq(friendships.addresseeId, characterId)),
        ),
      );

    for (const row of rows) {
      await this.push(row.requesterId === characterId ? row.addresseeId : row.requesterId);
    }
  }

  // ------------------------------------------------------------- phần nội bộ

  private isOnline(characterId: string): boolean {
    return this.sessions.get(characterId) !== undefined;
  }

  /** Hàng giữa hai người, **bất kể** chiều mời. */
  private async findPair(
    a: string,
    b: string,
  ): Promise<{ requesterId: string; addresseeId: string; status: string } | undefined> {
    const [row] = await this.db
      .select({
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
      })
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
          and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
        ),
      )
      .limit(1);
    return row;
  }

  private async countFriends(characterId: string): Promise<number> {
    const rows = await this.db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(eq(friendships.requesterId, characterId), eq(friendships.addresseeId, characterId)),
        ),
      );
    return rows.length;
  }

  /**
   * Chấp nhận một cặp sau khi khóa cả hai nhân vật theo thứ tự ổn định. Điều này kiểm trần cho cả
   * hai phía và tuần tự hóa hai lời chấp nhận đồng thời cùng làm một người vượt `MAX_FRIENDS`.
   */
  private async acceptPair(characterId: string, otherId: string): Promise<SocialResult> {
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(inArray(characters.id, [characterId, otherId]))
        .orderBy(asc(characters.id))
        .for('update');
      if (locked.length !== 2) {
        return fail(ErrorCode.CHARACTER_NOT_FOUND, 'không tìm thấy một trong hai nhân vật');
      }

      const acceptedPairs = await tx
        .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
        .from(friendships)
        .where(
          and(
            eq(friendships.status, 'accepted'),
            or(
              inArray(friendships.requesterId, [characterId, otherId]),
              inArray(friendships.addresseeId, [characterId, otherId]),
            ),
          ),
        );
      const counts = new Map([
        [characterId, 0],
        [otherId, 0],
      ]);
      for (const pair of acceptedPairs) {
        if (counts.has(pair.requesterId))
          counts.set(pair.requesterId, counts.get(pair.requesterId)! + 1);
        if (counts.has(pair.addresseeId))
          counts.set(pair.addresseeId, counts.get(pair.addresseeId)! + 1);
      }
      if ([characterId, otherId].some((id) => counts.get(id)! >= MAX_FRIENDS)) {
        return fail(ErrorCode.FRIENDS_FULL, `danh sách bạn đã đủ ${MAX_FRIENDS} người`);
      }

      const [updated] = await tx
        .update(friendships)
        .set({ status: 'accepted' })
        .where(
          and(
            eq(friendships.status, 'pending'),
            or(
              and(eq(friendships.requesterId, characterId), eq(friendships.addresseeId, otherId)),
              and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, characterId)),
            ),
          ),
        )
        .returning({ id: friendships.id });
      return updated
        ? { ok: true }
        : fail(ErrorCode.FRIEND_NOT_FOUND, 'lời mời kết bạn không còn tồn tại');
    });
  }

  private async pushTo(...characterIds: readonly string[]): Promise<void> {
    for (const characterId of characterIds) {
      await this.push(characterId);
    }
  }
}

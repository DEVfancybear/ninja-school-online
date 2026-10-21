import { and, desc, eq, sql } from 'drizzle-orm';
import { ErrorCode, MAIL_MAX_ENTRIES, type Mail, type Mails } from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characters, mails, type MailRow } from '../../db/schema.js';
import type { GameData } from '../../world/game-data.js';
import type { InventoryService } from '../inventory/service.js';

/** Khoá nghiệp vụ của thư chào mừng: unique `(character_id, mail_key)` bảo đảm chỉ gửi **một lần**. */
export const WELCOME_MAIL_KEY = 'welcome';

/** Nội dung thư chào mừng — món quà đầu tiên người chơi mới nhận được. */
export const WELCOME_MAIL = {
  subject: 'Thư chào mừng',
  body: 'Chào mừng bạn tới Làng Khởi Nguyên! Món quà nhỏ này là của bạn.',
  yen: 100,
  items: [{ itemId: 'item-banh-bao', qty: 1 }],
} as const;

/** Kết quả nhận quà: phần thưởng đã cộng, để tầng thế giới dựng gói tin và câu thông báo. */
export type MailClaimResult =
  | {
      readonly ok: true;
      readonly yen: number;
      readonly items: readonly {
        readonly itemId: string;
        readonly name: string;
        readonly qty: number;
      }[];
    }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

function fail(code: ErrorCode, message: string): MailClaimResult {
  return { ok: false, code, message };
}

/**
 * Hộp thư (M6). Nguồn sự thật là bảng `mails`; tên vật phẩm trong quà lấy từ `game-data` nên client
 * không phải tra cứu gì thêm.
 *
 * Thư hệ thống có `mail_key` để **không gửi trùng** (thư chào mừng), còn thư không có khoá thì gửi
 * bao nhiêu cũng được — việc chèn dựa vào unique index chứ không dựa vào việc đọc rồi ghi.
 */
export class MailService {
  constructor(
    private readonly db: Db,
    private readonly inventory: InventoryService,
    private readonly gameData: GameData,
  ) {}

  /** Gửi thư chào mừng nếu nhân vật chưa có. Gọi ở mỗi lần bắt tay — `on conflict do nothing` lo phần trùng. */
  async ensureWelcome(characterId: string): Promise<void> {
    await this.db
      .insert(mails)
      .values({
        characterId,
        mailKey: WELCOME_MAIL_KEY,
        subject: WELCOME_MAIL.subject,
        body: WELCOME_MAIL.body,
        yen: WELCOME_MAIL.yen,
        items: [...WELCOME_MAIL.items],
      })
      .onConflictDoNothing({ target: [mails.characterId, mails.mailKey] });
  }

  /** Toàn bộ hộp thư, mới nhất trước, tối đa `MAIL_MAX_ENTRIES` lá. */
  async list(characterId: string): Promise<Mails> {
    const rows = await this.db
      .select()
      .from(mails)
      .where(eq(mails.characterId, characterId))
      .orderBy(desc(mails.createdAt), desc(mails.id))
      .limit(MAIL_MAX_ENTRIES);

    return { mails: rows.map((row) => this.toMail(row)), maxEntries: MAIL_MAX_ENTRIES };
  }

  /**
   * Nhận quà và đánh dấu thư trong một transaction. Khóa thư ngăn claim lặp; khóa nhân vật đồng
   * bộ với các lần cấp vật phẩm khác để kiểm túi và ghi quà không bị race.
   */
  async claim(characterId: string, mailId: string): Promise<MailClaimResult> {
    return this.db.transaction(async (tx) => {
      const [mail] = await tx
        .select()
        .from(mails)
        .where(and(eq(mails.id, mailId), eq(mails.characterId, characterId)))
        .for('update')
        .limit(1);
      if (!mail) {
        return fail(ErrorCode.MAIL_NOT_FOUND, 'không tìm thấy lá thư này trong hộp thư của bạn');
      }
      if (mail.claimedAt !== null) {
        return fail(ErrorCode.MAIL_CLAIMED, 'bạn đã nhận quà của lá thư này rồi');
      }

      const [character] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, characterId))
        .for('update');
      if (!character) {
        return fail(ErrorCode.NO_CHARACTER, 'không tìm thấy nhân vật');
      }

      const grant = await this.inventory.grantItems(characterId, mail.items, tx);
      if (grant === 'inventory_full') {
        return fail(ErrorCode.INVENTORY_FULL, 'túi đồ đã đầy; dọn túi rồi nhận thư lại');
      }
      if (grant === 'unknown_item') {
        return fail(ErrorCode.INTERNAL, 'thư có vật phẩm không tồn tại trong dữ liệu trò chơi');
      }

      if (mail.yen > 0) {
        await tx
          .update(characters)
          .set({ yen: sql`${characters.yen} + ${mail.yen}`, updatedAt: sql`now()` })
          .where(eq(characters.id, characterId));
      }
      const [claimed] = await tx
        .update(mails)
        .set({ claimedAt: sql`now()` })
        .where(
          and(
            eq(mails.id, mailId),
            eq(mails.characterId, characterId),
            sql`${mails.claimedAt} is null`,
          ),
        )
        .returning({ id: mails.id });
      if (!claimed) {
        return fail(ErrorCode.MAIL_CLAIMED, 'bạn đã nhận quà của lá thư này rồi');
      }

      const items = mail.items.map((item) => ({
        itemId: item.itemId,
        name: this.itemName(item.itemId),
        qty: item.qty,
      }));
      return { ok: true, yen: mail.yen, items };
    });
  }

  // ------------------------------------------------------------- phần nội bộ

  private toMail(row: MailRow): Mail {
    return {
      id: row.id,
      subject: row.subject,
      body: row.body,
      yen: row.yen,
      items: row.items.map((item) => ({
        itemId: item.itemId,
        name: this.itemName(item.itemId),
        qty: item.qty,
      })),
      claimed: row.claimedAt !== null,
      sentAt: row.createdAt.getTime(),
    };
  }

  /** Tên vật phẩm theo `game-data`; món lạ (dữ liệu cũ) thì hiện chính mã món. */
  private itemName(itemId: string): string {
    return this.gameData.items.get(itemId)?.name ?? itemId;
  }
}

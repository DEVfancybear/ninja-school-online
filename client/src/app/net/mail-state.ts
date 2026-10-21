import { Injectable, computed, signal } from '@angular/core';
import { MAIL_MAX_ENTRIES, Opcode, type Mail, type Mails } from '@ninja/shared';

/** Ngôi nhà của `Mails` khi hộp thư còn rỗng (chưa nhận `S2C_MAILS` lần nào). */
export function emptyMails(): Mails {
  return { mails: [], maxEntries: MAIL_MAX_ENTRIES };
}

/**
 * Hộp thư ở phía client.
 *
 * `S2C_MAILS` gửi lại **toàn bộ** hộp thư sau mỗi lần có thư mới hoặc có thư vừa được nhận quà, nên
 * service chỉ thay cả cục. Số thư chưa nhận quà được **tính từ danh sách** thay vì đếm riêng: chỉ
 * có một nguồn sự thật, và huy hiệu trên HUD tự đúng khi server đánh dấu `claimed`.
 */
@Injectable({ providedIn: 'root' })
export class MailState {
  private readonly mailsSignal = signal<Mails>(emptyMails());

  readonly mails = computed<readonly Mail[]>(() => this.mailsSignal().mails);
  readonly maxEntries = computed(() => this.mailsSignal().maxEntries);

  /** Số thư còn quà chưa nhận — con số trên huy hiệu nút Thư. */
  readonly unclaimedCount = computed(
    () => this.mailsSignal().mails.filter((mail) => !mail.claimed).length,
  );

  /** Áp một gói server gửi xuống; trả về `false` nếu gói không thuộc phần hộp thư. */
  applyPacket(op: number, payload: unknown): boolean {
    if (op !== Opcode.S2C_MAILS) {
      return false;
    }
    this.mailsSignal.set(payload as Mails);
    return true;
  }

  /** Mất kết nối hoặc rời trang: bỏ hộp thư của lần chơi trước. */
  reset(): void {
    this.mailsSignal.set(emptyMails());
  }
}

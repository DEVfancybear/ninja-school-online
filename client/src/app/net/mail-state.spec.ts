import { TestBed } from '@angular/core/testing';
import { MAIL_MAX_ENTRIES, Opcode, type Mail, type Mails } from '@ninja/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { MailState } from './mail-state';

function mail(overrides: Partial<Mail> = {}): Mail {
  return {
    id: 'mail-1',
    subject: 'Qùa khai trường',
    body: 'Chúc bạn học tốt.',
    yen: 100,
    items: [],
    claimed: false,
    sentAt: 1_760_000_000_000,
    ...overrides,
  };
}

function mails(overrides: Partial<Mails> = {}): Mails {
  return { mails: [], maxEntries: MAIL_MAX_ENTRIES, ...overrides };
}

describe('MailState', () => {
  let inbox: MailState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    inbox = TestBed.inject(MailState);
  });

  it('bắt đầu trống, không có thư nào chưa nhận', () => {
    expect(inbox.mails()).toEqual([]);
    expect(inbox.maxEntries()).toBe(MAIL_MAX_ENTRIES);
    expect(inbox.unclaimedCount()).toBe(0);
  });

  it('S2C_MAILS thay cả hộp thư và đếm thư chưa nhận quà', () => {
    expect(
      inbox.applyPacket(
        Opcode.S2C_MAILS,
        mails({ mails: [mail(), mail({ id: 'mail-2', claimed: true, subject: 'Thư cũ' })] }),
      ),
    ).toBe(true);

    expect(inbox.mails().map((item) => item.subject)).toEqual(['Qùa khai trường', 'Thư cũ']);
    // Chỉ đếm thư còn quà: thư đã nhận vẫn nằm trong hộp nhưng không nhắc nữa.
    expect(inbox.unclaimedCount()).toBe(1);
  });

  it('unclaimedCount giảm sau khi nhận thư vì server gửi lại hộp thư đã đánh dấu claimed', () => {
    inbox.applyPacket(Opcode.S2C_MAILS, mails({ mails: [mail(), mail({ id: 'mail-2' })] }));
    expect(inbox.unclaimedCount()).toBe(2);

    // Nhận quà thành công: cùng lá thư đó, `claimed` đã thành true.
    inbox.applyPacket(
      Opcode.S2C_MAILS,
      mails({ mails: [mail({ claimed: true }), mail({ id: 'mail-2' })] }),
    );

    expect(inbox.unclaimedCount()).toBe(1);
    expect(inbox.mails()[0]?.claimed).toBe(true);
  });

  it('thư đã nhận hết thì huy hiệu về 0 mà hộp vẫn còn thư để đọc', () => {
    inbox.applyPacket(Opcode.S2C_MAILS, mails({ mails: [mail({ claimed: true })] }));

    expect(inbox.unclaimedCount()).toBe(0);
    expect(inbox.mails()).toHaveLength(1);
  });

  it('bỏ qua gói không thuộc phần hộp thư và xoá sạch khi reset()', () => {
    expect(inbox.applyPacket(Opcode.S2C_SOCIAL_UPDATE, {})).toBe(false);

    inbox.applyPacket(Opcode.S2C_MAILS, mails({ mails: [mail()] }));
    inbox.reset();

    expect(inbox.mails()).toEqual([]);
    expect(inbox.unclaimedCount()).toBe(0);
  });
});

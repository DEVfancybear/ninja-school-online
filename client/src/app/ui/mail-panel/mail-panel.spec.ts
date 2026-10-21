import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAIL_MAX_ENTRIES, type Mail } from '@ninja/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MailPanel } from './mail-panel';

function mail(overrides: Partial<Mail> = {}): Mail {
  return {
    id: 'mail-1',
    subject: 'Quà khai trường',
    body: 'Chúc bạn học tốt.',
    yen: 100,
    items: [],
    claimed: false,
    sentAt: 1_760_000_000_000,
    ...overrides,
  };
}

describe('MailPanel', () => {
  let fixture: ComponentFixture<MailPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(mails: readonly Mail[]): Promise<ComponentFixture<MailPanel>> {
    await TestBed.configureTestingModule({ imports: [MailPanel] }).compileComponents();
    const created = TestBed.createComponent(MailPanel);
    created.componentRef.setInput('mails', mails);
    created.componentRef.setInput('maxEntries', MAIL_MAX_ENTRIES);
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function click(selector: string): void {
    const target = element().querySelector<HTMLElement>(selector);
    expect(target, `không thấy ${selector}`).not.toBeNull();
    target?.click();
    fixture?.detectChanges();
  }

  it('mỗi thư hiện tiêu đề, nội dung và quà kèm theo', async () => {
    fixture = await setup([
      mail({
        subject: 'Quà khai trường',
        body: 'Chúc bạn học tốt.',
        yen: 100,
        items: [{ itemId: 'item-da-vun', name: 'Đá Vụn', qty: 2 }],
      }),
    ]);

    expect(element().querySelectorAll('.mail-item')).toHaveLength(1);
    expect(element().querySelector('.mail-item__subject')?.textContent?.trim()).toBe(
      'Quà khai trường',
    );
    expect(element().querySelector('.mail-item__body')?.textContent?.trim()).toBe(
      'Chúc bạn học tốt.',
    );
    const gift = element().querySelector('.mail-item__gift')?.textContent?.trim() ?? '';
    expect(gift).toContain('100 yên');
    expect(gift).toContain('Đá Vụn ×2');
  });

  it('bấm Nhận quà phát đúng id lá thư đó', async () => {
    fixture = await setup([mail({ id: 'mail-1' }), mail({ id: 'mail-2', subject: 'Thư hai' })]);
    const claimed: string[] = [];
    fixture.componentInstance.claim.subscribe((mailId) => claimed.push(mailId));

    click('.mail-item:nth-child(2) .mail-claim');

    expect(claimed).toEqual(['mail-2']);
  });

  it('thư đã nhận quà mang lớp --claimed và không còn nút nhận', async () => {
    fixture = await setup([mail({ claimed: true })]);

    expect(element().querySelector('.mail-item--claimed')).not.toBeNull();
    expect(element().querySelector('.mail-claim')).toBeNull();
    expect(element().querySelector('.mail-item__claimed')).not.toBeNull();
  });

  it('thư không kèm quà thì nói rõ thay vì để trống', async () => {
    fixture = await setup([mail({ yen: 0, items: [] })]);

    expect(element().querySelector('.mail-item__gift')?.textContent?.trim()).toBe('Không kèm quà');
  });

  it('hộp rỗng thì hiện .mail-panel__empty', async () => {
    fixture = await setup([]);

    expect(element().querySelector('.mail-panel__empty')).not.toBeNull();
    expect(element().querySelectorAll('.mail-item')).toHaveLength(0);
  });

  it('nút đóng phát `closed`', async () => {
    fixture = await setup([]);
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    click('.mail-panel__close');

    expect(closed).toBe(1);
  });
});

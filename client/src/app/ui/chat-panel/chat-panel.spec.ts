import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { CHAT_MAX_LENGTH, type ChatChannel } from '@ninja/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatLine } from '../../net/world-state';
import { ChatPanel, type ChatDraft } from './chat-panel';

function line(overrides: Partial<ChatLine> = {}): ChatLine {
  return {
    channel: 'map',
    fromName: 'Kakashi',
    text: 'Chào cả đội',
    at: 1_760_000_000_000,
    fromId: 'p2',
    ...overrides,
  };
}

describe('ChatPanel', () => {
  let fixture: ComponentFixture<ChatPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(messages: readonly ChatLine[] = []): Promise<ComponentFixture<ChatPanel>> {
    await TestBed.configureTestingModule({ imports: [ChatPanel] }).compileComponents();
    const created = TestBed.createComponent(ChatPanel);
    created.componentRef.setInput('messages', messages);
    created.componentRef.setInput('selfId', 'p1');
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function type(selector: string, value: string): void {
    const input = element().querySelector<HTMLInputElement>(selector);
    expect(input, `không thấy ${selector}`).not.toBeNull();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    fixture?.detectChanges();
  }

  function chooseChannel(channel: ChatChannel): void {
    const select = element().querySelector<HTMLSelectElement>('.chat-channel');
    expect(select).not.toBeNull();
    if (select) {
      select.value = channel;
      select.dispatchEvent(new Event('change'));
    }
    fixture?.detectChanges();
  }

  function submit(): void {
    element().querySelector('.compose')?.dispatchEvent(new Event('submit'));
    fixture?.detectChanges();
  }

  function sendButton(): HTMLButtonElement | null {
    return element().querySelector<HTMLButtonElement>('.chat-send');
  }

  it('có đủ bốn kênh với nhãn tiếng Việt và mặc định là kênh bản đồ', async () => {
    fixture = await setup();

    const options = [...element().querySelectorAll<HTMLOptionElement>('.chat-channel option')];
    expect(options.map((option) => option.value)).toEqual(['map', 'world', 'party', 'private']);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Bản đồ',
      'Thế giới',
      'Tổ đội',
      'Riêng',
    ]);
    expect(element().querySelector<HTMLSelectElement>('.chat-channel')?.value).toBe('map');
    expect(element().querySelector('.chat-target')).toBeNull();
  });

  it('kênh bản đồ gửi tin không kèm người nhận', async () => {
    fixture = await setup();
    const sent: ChatDraft[] = [];
    fixture.componentInstance.send.subscribe((draft) => sent.push(draft));

    type('.chat-input', '  ai ở đây không  ');
    submit();

    // Câu được cắt khoảng trắng hai đầu; kênh bản đồ không có `to`.
    expect(sent).toEqual([{ channel: 'map', text: 'ai ở đây không' }]);
  });

  it('kênh thế giới và tổ đội cũng không kèm người nhận', async () => {
    fixture = await setup();
    const sent: ChatDraft[] = [];
    fixture.componentInstance.send.subscribe((draft) => sent.push(draft));

    chooseChannel('world');
    expect(element().querySelector('.chat-target')).toBeNull();
    type('.chat-input', 'chào thế giới');
    submit();

    chooseChannel('party');
    expect(element().querySelector('.chat-target')).toBeNull();
    type('.chat-input', 'đi đâu thế');
    submit();

    expect(sent.map((draft) => draft.channel)).toEqual(['world', 'party']);
    expect(sent.every((draft) => !('to' in draft))).toBe(true);
  });

  it('chọn kênh riêng thì hiện ô người nhận và gửi kèm `to`', async () => {
    fixture = await setup();
    const sent: ChatDraft[] = [];
    fixture.componentInstance.send.subscribe((draft) => sent.push(draft));

    chooseChannel('private');
    expect(element().querySelector('.chat-target')).not.toBeNull();

    type('.chat-target', ' Sasuke ');
    type('.chat-input', 'gặp riêng chút');
    submit();

    expect(sent).toEqual([{ channel: 'private', text: 'gặp riêng chút', to: 'Sasuke' }]);
  });

  it('kênh riêng mà chưa nhập người nhận thì nút Gửi khoá và không gửi gì', async () => {
    fixture = await setup();
    const sent: ChatDraft[] = [];
    fixture.componentInstance.send.subscribe((draft) => sent.push(draft));

    chooseChannel('private');
    type('.chat-input', 'gặp riêng chút');

    expect(sendButton()?.disabled).toBe(true);
    submit();

    expect(sent).toEqual([]);

    // Nhập người nhận xong mới gửi được.
    type('.chat-target', 'Sasuke');
    expect(sendButton()?.disabled).toBe(false);
  });

  it('đổi từ kênh riêng sang kênh khác thì bỏ người nhận đã gõ', async () => {
    fixture = await setup();
    const sent: ChatDraft[] = [];
    fixture.componentInstance.send.subscribe((draft) => sent.push(draft));

    chooseChannel('private');
    type('.chat-target', 'Sasuke');
    chooseChannel('world');
    type('.chat-input', 'chào cả làng');
    submit();

    expect(element().querySelector('.chat-target')).toBeNull();
    expect(sent).toEqual([{ channel: 'world', text: 'chào cả làng' }]);
  });

  it('gõ quá trần ký tự thì cắt bớt trước khi gửi', async () => {
    fixture = await setup();
    const sent: ChatDraft[] = [];
    fixture.componentInstance.send.subscribe((draft) => sent.push(draft));

    type('.chat-input', 'a'.repeat(CHAT_MAX_LENGTH + 10));
    submit();

    expect(sent[0]?.text).toHaveLength(CHAT_MAX_LENGTH);
  });

  it('mỗi dòng chat mang lớp theo kênh và tiền tố tên kênh', async () => {
    fixture = await setup([
      line({ channel: 'map', fromName: 'Kakashi', text: 'tin bản đồ' }),
      line({ channel: 'world', fromName: 'Naruto', text: 'tin thế giới' }),
      line({ channel: 'party', fromName: 'Sakura', text: 'tin tổ đội' }),
      line({ channel: 'private', fromName: 'Sasuke', toName: 'Kakashi', text: 'tin riêng' }),
      line({ channel: 'system', fromName: '', text: 'chào mừng', fromId: undefined }),
    ]);

    const rows = [...element().querySelectorAll<HTMLElement>('.chat-line')];
    expect(rows).toHaveLength(5);
    expect(rows[0]?.className).toContain('chat-line');
    expect(rows[0]?.className).not.toContain('chat-line--world');
    expect(rows[1]?.className).toContain('chat-line--world');
    expect(rows[2]?.className).toContain('chat-line--party');
    expect(rows[3]?.className).toContain('chat-line--private');
    expect(rows[4]?.className).toContain('system');

    // Tiền tố tên kênh chỉ có ở kênh không phải bản đồ.
    expect(rows[0]?.querySelector('.chat-from')?.textContent?.trim()).toBe('Kakashi');
    expect(rows[1]?.querySelector('.chat-from')?.textContent).toContain('[Thế giới] Naruto');
    expect(rows[2]?.querySelector('.chat-from')?.textContent).toContain('[Tổ đội] Sakura');
    // Tin riêng hiện "Tên → Người nhận".
    const privateFrom = rows[3]?.querySelector('.chat-from')?.textContent ?? '';
    expect(privateFrom).toContain('Sasuke');
    expect(privateFrom).toContain('→');
    expect(privateFrom).toContain('Kakashi');
  });

  it('câu lỗi server gửi hiện nguyên văn ở dòng thông báo', async () => {
    fixture = await setup();
    fixture.componentRef.setInput('notice', 'Bạn gửi tin quá nhanh, thử lại sau.');
    fixture.detectChanges();

    expect(element().querySelector('.chat-notice')?.textContent?.trim()).toBe(
      'Bạn gửi tin quá nhanh, thử lại sau.',
    );
  });
});

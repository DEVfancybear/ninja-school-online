import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CHAT_MAX_LENGTH, type ChatChannel, type ChatSendChannel } from '@ninja/shared';
import type { ChatLine } from '../../net/world-state';

/**
 * Một tin người chơi muốn gửi.
 *
 * `to` chỉ có ở kênh `private`: hợp đồng (`ChatSendSchema`) từ chối tin riêng thiếu người nhận và
 * cũng từ chối kênh khác có `to`, nên kiểu dữ liệu để `to` tuỳ chọn và chỗ dựng gói quyết định.
 */
export interface ChatDraft {
  readonly channel: ChatSendChannel;
  readonly text: string;
  readonly to?: string;
}

/** Năm kênh người chơi chọn được, kèm nhãn tiếng Việt. `system` chỉ server dùng. */
export const CHAT_CHANNEL_OPTIONS: readonly {
  readonly value: ChatSendChannel;
  readonly label: string;
  /** Tiền tố hiện trước tên người gửi; kênh `map` không có tiền tố (giữ như M2). */
  readonly prefix: string | null;
}[] = [
  { value: 'map', label: 'Bản đồ', prefix: null },
  { value: 'world', label: 'Thế giới', prefix: 'Thế giới' },
  { value: 'party', label: 'Tổ đội', prefix: 'Tổ đội' },
  { value: 'guild', label: 'Bang', prefix: 'Bang' },
  { value: 'private', label: 'Riêng', prefix: 'Riêng' },
];

/**
 * Khung chat nhiều kênh: danh sách tin nhắn (phân biệt tin hệ thống / của mình / người khác, và
 * kênh nào với kênh nào), chọn kênh, ô người nhận cho tin riêng, ô nhập giới hạn
 * `CHAT_MAX_LENGTH` ký tự, gửi bằng Enter, và một dòng thông báo khi server chặn (gửi quá nhanh,
 * chưa ở tổ đội, không tìm thấy người nhận…).
 *
 * Component chỉ phát ra `ChatDraft`; trang `/play` dựng gói `C2S_CHAT` đúng hợp đồng.
 */
@Component({
  selector: 'app-chat-panel',
  imports: [FormsModule],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPanel {
  readonly messages = input<readonly ChatLine[]>([]);
  readonly selfId = input<string | null>(null);
  /** Thông báo cục bộ, ví dụ "bạn gửi quá nhanh". */
  readonly notice = input<string | null>(null);
  readonly disabled = input(false);

  readonly send = output<ChatDraft>();

  readonly maxLength = CHAT_MAX_LENGTH;
  readonly channels = CHAT_CHANNEL_OPTIONS;
  readonly draft = signal('');
  readonly channel = signal<ChatSendChannel>('map');
  /** Tên người nhận của tin riêng; chỉ dùng khi `channel()` là `private`. */
  readonly target = signal('');

  private readonly logElement = viewChild<ElementRef<HTMLElement>>('chatLog');

  constructor() {
    effect(() => {
      // Tin mới nhất phải nằm trong tầm nhìn; đọc `messages()` để hiệu ứng chạy mỗi lần có tin.
      this.messages();
      const element = this.logElement()?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  /** Đang chọn kênh riêng: ô người nhận hiện ra và nút gửi phụ thuộc vào nó. */
  isPrivateChannel(): boolean {
    return this.channel() === 'private';
  }

  isMine(line: ChatLine): boolean {
    const selfId = this.selfId();
    return selfId !== null && line.fromId === selfId;
  }

  /** Tiền tố tên kênh cho từng dòng; `null` với kênh bản đồ và tin hệ thống. */
  channelPrefix(channel: ChatChannel): string | null {
    return this.channels.find((option) => option.value === channel)?.prefix ?? null;
  }

  onDraft(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.set(value.slice(0, this.maxLength));
  }

  onTarget(event: Event): void {
    this.target.set((event.target as HTMLInputElement).value.slice(0, MAX_NAME_LENGTH));
  }

  onChannel(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ChatSendChannel;
    this.channel.set(value);
    if (value !== 'private') {
      // Đổi sang kênh khác thì bỏ người nhận: hợp đồng không cho kênh khác kèm `to`.
      this.target.set('');
    }
  }

  /** Ô Gửi khoá khi mất kết nối, khi chưa gõ chữ, hoặc khi chọn tin riêng mà chưa có người nhận. */
  canSend(): boolean {
    if (this.disabled() || this.draft().trim().length === 0) {
      return false;
    }
    return this.channel() !== 'private' || this.target().trim().length > 0;
  }

  submit(): void {
    if (!this.canSend()) {
      return;
    }
    const channel = this.channel();
    const text = this.draft().trim().slice(0, this.maxLength);
    const to = this.target().trim();
    this.send.emit(channel === 'private' ? { channel, text, to } : { channel, text });
    this.draft.set('');
  }
}

/** Trần ký tự tên nhân vật trong hợp đồng (`ChatSendSchema.to`). */
const MAX_NAME_LENGTH = 24;

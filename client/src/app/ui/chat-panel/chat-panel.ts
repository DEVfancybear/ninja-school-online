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
import { CHAT_MAX_LENGTH } from '@ninja/shared';
import type { ChatLine } from '../../net/world-state';

/**
 * Khung chat kênh `map`: danh sách tin nhắn (phân biệt tin hệ thống / của mình / người khác),
 * ô nhập giới hạn `CHAT_MAX_LENGTH` ký tự, gửi bằng Enter, và một dòng thông báo khi server
 * chặn vì gửi quá nhanh.
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

  readonly send = output<string>();

  readonly maxLength = CHAT_MAX_LENGTH;
  readonly draft = signal('');

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

  isMine(line: ChatLine): boolean {
    const selfId = this.selfId();
    return selfId !== null && line.fromId === selfId;
  }

  onDraft(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.set(value.slice(0, this.maxLength));
  }

  submit(): void {
    const text = this.draft().trim().slice(0, this.maxLength);
    if (text.length === 0 || this.disabled()) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
  }
}

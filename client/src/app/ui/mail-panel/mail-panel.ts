import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Mail } from '@ninja/shared';

/**
 * Hộp thư: từng lá thư, quà kèm theo và nút nhận quà.
 *
 * Component **không** gửi gói tin: nút "Nhận quà" chỉ phát ra `mailId`, còn `/play` dựng
 * `C2S_MAIL_CLAIM`. Lá thư đã nhận quà vẫn nằm trong hộp (server giữ lại để đọc), chỉ đổi trạng
 * thái hiển thị — vì vậy không lọc bỏ mà gắn lớp `--claimed`.
 */
@Component({
  selector: 'app-mail-panel',
  templateUrl: './mail-panel.html',
  styleUrl: './mail-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailPanel {
  readonly mails = input<readonly Mail[]>([]);
  /** Trần số thư hộp thư giữ được, để hiện "3/20". */
  readonly maxEntries = input(0);

  readonly claim = output<string>();
  readonly closed = output<void>();

  /** Mô tả quà của một lá thư: yên trước, rồi từng món; thư không kèm gì thì nói rõ. */
  giftText(mail: Mail): string {
    const parts: string[] = [];
    if (mail.yen > 0) {
      parts.push(`${mail.yen} yên`);
    }
    for (const item of mail.items) {
      parts.push(`${item.name} ×${item.qty}`);
    }
    return parts.length === 0 ? 'Không kèm quà' : `Quà: ${parts.join(', ')}`;
  }
}

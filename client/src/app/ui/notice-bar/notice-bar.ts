import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Thanh thông báo trên cùng cho `S2C_NOTIFY` và `S2C_ERROR`.
 * Việc tự ẩn sau vài giây do trang `/play` quyết định (nó là bên giữ hàng đợi thông báo),
 * component này chỉ hiển thị.
 */
@Component({
  selector: 'app-notice-bar',
  templateUrl: './notice-bar.html',
  styleUrl: './notice-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoticeBar {
  readonly notice = input<string | null>(null);
}

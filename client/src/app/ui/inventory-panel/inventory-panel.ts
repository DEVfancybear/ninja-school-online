import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { InventoryItem } from '@ninja/shared';

/**
 * Túi đồ: danh sách vật phẩm, số ô đang dùng và nút dùng cho vật phẩm hồi phục. Component chỉ phát
 * ra ý định dùng (`use`), trang `/play` gửi gói tin — cùng cách làm với các lớp giao diện khác.
 */
@Component({
  selector: 'app-inventory-panel',
  templateUrl: './inventory-panel.html',
  styleUrl: './inventory-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryPanel {
  readonly items = input<readonly InventoryItem[]>([]);
  readonly capacity = input(0);
  /** Trong trận thì dùng vật phẩm là một lượt, nên nút "Dùng" ở đây phải khoá lại. */
  readonly locked = input(false);

  readonly use = output<string>();
  readonly closed = output<void>();
}

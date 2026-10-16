import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  EQUIP_SLOT_LABELS,
  upgradeMaxLevelOf,
  upgradeSuccessRate,
  upgradeYenCost,
  type InventoryItem,
} from '@ninja/shared';
import { statsText } from '../../core/game-labels';

/** Lần cường hóa kế tiếp của một món: chi phí, tỉ lệ và đã chạm trần chưa. */
interface UpgradeInfo {
  readonly yen: number;
  readonly ratePercent: number;
  readonly maxed: boolean;
}

/** Một dòng túi đồ kèm phần chữ đã soạn sẵn cho giao diện. */
interface BagRow {
  readonly item: InventoryItem;
  readonly stats: string;
  readonly plus: string;
  /** Tên ô mặc bằng tiếng Việt, rỗng với món không mặc được. */
  readonly slotLabel: string;
  /** `null` với món không cường hóa được (`upgradeMaxLevel` bằng 0). */
  readonly upgrade: UpgradeInfo | null;
}

/**
 * Túi đồ: danh sách vật phẩm, số ô đang dùng và các nút hành động. Component chỉ phát ra ý định
 * (`use`, `equip`, `upgrade`), trang `/play` gửi gói tin — cùng cách làm với các lớp giao diện khác.
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
  readonly equip = output<string>();
  readonly upgrade = output<string>();
  readonly closed = output<void>();

  /**
   * Chi phí và tỉ lệ cường hóa lấy từ `@ninja/shared` — đúng bộ số server dùng để quyết định kết
   * quả, nên hiện ở đây không thể lệch với thực tế. Món đã chạm trần (`upgradeLevel` bằng trần của
   * món, tính cả trần chung) thì nút chuyển sang trạng thái tối đa.
   */
  readonly rows = computed<readonly BagRow[]>(() =>
    this.items().map((item) => {
      const maxLevel = upgradeMaxLevelOf(item.upgradeMaxLevel);
      return {
        item,
        stats: statsText(item.stats),
        plus: item.upgradeLevel > 0 ? `+${item.upgradeLevel}` : '',
        slotLabel: item.slot ? EQUIP_SLOT_LABELS[item.slot] : '',
        upgrade:
          maxLevel > 0
            ? {
                yen: upgradeYenCost(item.upgradeLevel),
                ratePercent: Math.round(upgradeSuccessRate(item.upgradeLevel) * 100),
                maxed: item.upgradeLevel >= maxLevel,
              }
            : null,
      };
    }),
  );
}

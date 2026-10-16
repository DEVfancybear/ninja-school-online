import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { type Shop, type InventoryItem, type ShopEntry } from '@ninja/shared';
import { statsText } from '../../core/game-labels';

/** Một dòng bảng "Mua": đủ để hiện tên, giá, cấp yêu cầu và phần mô tả thêm. */
interface BuyRow {
  readonly itemId: string;
  readonly name: string;
  readonly price: number;
  readonly levelRequired: number;
  /** Chỉ số cộng thêm, hoặc tác dụng hồi phục với món ăn; rỗng khi món không có gì để nói. */
  readonly note: string;
}

/**
 * Bảng shop của NPC đang nói chuyện: bảng "Mua" lấy hàng từ gói `S2C_NPC_DIALOG`, bảng "Bán" lấy
 * thẳng túi đồ của người chơi (không lọc theo hàng của shop — server là bên quyết định bán được
 * món nào). Component chỉ phát ra ý định mua/bán, trang `/play` gửi gói tin.
 */
@Component({
  selector: 'app-shop-panel',
  templateUrl: './shop-panel.html',
  styleUrl: './shop-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPanel {
  readonly shop = input.required<Shop>();
  readonly npcName = input('');
  readonly items = input<readonly InventoryItem[]>([]);

  readonly buy = output<string>();
  readonly sell = output<string>();
  readonly closed = output<void>();

  readonly rows = computed<readonly BuyRow[]>(() =>
    this.shop().entries.map((entry) => ({
      itemId: entry.itemId,
      name: entry.name,
      price: entry.price,
      levelRequired: entry.levelRequired,
      note: entryNote(entry),
    })),
  );
}

/** Điều duy nhất đáng nói thêm về một món hàng: chỉ số cộng thêm, nếu không thì tác dụng hồi phục. */
function entryNote(entry: ShopEntry): string {
  const stats = statsText(entry.stats);
  if (stats) {
    return stats;
  }
  const heal: string[] = [];
  if (entry.healHp) {
    heal.push(`hồi ${entry.healHp} máu`);
  }
  if (entry.healMp) {
    heal.push(`hồi ${entry.healMp} nội lực`);
  }
  return heal.join(' · ');
}

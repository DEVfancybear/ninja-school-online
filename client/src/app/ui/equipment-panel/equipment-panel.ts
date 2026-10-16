import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABELS,
  type EquipSlot,
  type EquipmentSlot,
  type InventoryItem,
} from '@ninja/shared';
import { statsText } from '../../core/game-labels';

/** Một dòng của bảng trang bị: tên ô, món đang mặc và phần chỉ số cộng thêm. */
interface GearRow {
  readonly slot: EquipSlot;
  readonly label: string;
  readonly item: InventoryItem | null;
  readonly plus: string;
  readonly stats: string;
}

/**
 * Bảng trang bị: bốn ô theo thứ tự `EQUIP_SLOTS`, ô đang mặc hiện tên món, cấp cường hóa và chỉ số
 * cộng thêm. Component chỉ phát ra ý định tháo (`unequip`), trang `/play` gửi gói tin.
 */
@Component({
  selector: 'app-equipment-panel',
  templateUrl: './equipment-panel.html',
  styleUrl: './equipment-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquipmentPanel {
  readonly equipment = input<readonly EquipmentSlot[]>([]);

  readonly unequip = output<EquipSlot>();
  readonly closed = output<void>();

  /**
   * Bốn dòng theo đúng thứ tự `EQUIP_SLOTS`. Hợp đồng không hứa thứ tự ô trong `S2C_EQUIPMENT`, nên
   * bảng tự xếp lại theo bảng hằng của `@ninja/shared` để hai bên client và server không lệch nhau.
   */
  readonly rows = computed<readonly GearRow[]>(() => {
    const bySlot = new Map(this.equipment().map((entry) => [entry.slot, entry.item] as const));
    return EQUIP_SLOTS.map((slot) => {
      const item = bySlot.get(slot) ?? null;
      return {
        slot,
        label: EQUIP_SLOT_LABELS[slot],
        item,
        plus: item && item.upgradeLevel > 0 ? `+${item.upgradeLevel}` : '',
        stats: item ? statsText(item.stats) : '',
      };
    });
  });
}

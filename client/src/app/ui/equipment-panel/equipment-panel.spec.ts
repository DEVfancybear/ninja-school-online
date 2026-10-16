import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABELS,
  type EquipmentSlot,
  type InventoryItem,
} from '@ninja/shared';
import { EquipmentPanel } from './equipment-panel';

/** Món đang mặc dạng server gửi: `stats` đã tính cả cường hóa, nên giao diện không cộng lại. */
function gearItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    itemId: 'item-kiem-go',
    name: 'Kiếm Gỗ',
    kind: 'weapon',
    quantity: 1,
    usable: false,
    description: 'Vũ khí tập luyện',
    slot: 'weapon',
    upgradeLevel: 0,
    stats: { strength: 2, agility: 1, spirit: 0, hp: 8, mp: 0 },
    levelRequired: 1,
    price: 80,
    sellPrice: 32,
    upgradeMaxLevel: 5,
    ...overrides,
  };
}

/** Bốn ô trang bị, chỉ ô truyền vào là có món. */
function equipmentWith(item: InventoryItem | null, slot = 'weapon'): EquipmentSlot[] {
  return EQUIP_SLOTS.map((candidate) => ({
    slot: candidate,
    item: candidate === slot ? item : null,
  }));
}

describe('EquipmentPanel', () => {
  let fixture: ComponentFixture<EquipmentPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(equipment: EquipmentSlot[]): Promise<ComponentFixture<EquipmentPanel>> {
    await TestBed.configureTestingModule({ imports: [EquipmentPanel] }).compileComponents();
    const created = TestBed.createComponent(EquipmentPanel);
    created.componentRef.setInput('equipment', equipment);
    created.detectChanges();
    return created;
  }

  function rows(): Element[] {
    return [...(fixture?.nativeElement as HTMLElement).querySelectorAll('.gear__row')];
  }

  it('vẽ đủ bốn ô theo thứ tự EQUIP_SLOTS, ô trống hiện tên ô và chữ Trống', async () => {
    fixture = await setup(equipmentWith(null));

    expect(rows()).toHaveLength(EQUIP_SLOTS.length);
    expect(rows().map((row) => row.querySelector('.gear__slot')?.textContent?.trim())).toEqual(
      EQUIP_SLOTS.map((slot) => EQUIP_SLOT_LABELS[slot]),
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      'Vũ khíTrống',
      'ÁoTrống',
      'MũTrống',
      'Phụ kiệnTrống',
    ]);
    expect(rows().map((row) => row.querySelector('.gear__unequip'))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('ô đang mặc hiện tên món, cấp cường hóa và chỉ số cộng thêm', async () => {
    fixture = await setup(equipmentWith(gearItem({ upgradeLevel: 2 })));

    const weaponRow = rows()[0];
    expect(weaponRow?.textContent).toContain('Kiếm Gỗ');
    expect(weaponRow?.querySelector('.gear__plus')?.textContent?.trim()).toBe('+2');
    const stats = weaponRow?.querySelector('.gear__stats')?.textContent ?? '';
    expect(stats).toContain('Sức mạnh +2');
    expect(stats).toContain('Nhanh nhẹn +1');
    expect(stats).toContain('Máu +8');
    // Chỉ số bằng 0 không hiện: chữ "Tinh thần +0" chỉ làm rối mắt.
    expect(stats).not.toContain('Tinh thần');

    const bodyRow = rows()[1];
    expect(bodyRow?.textContent).toContain('Áo');
    expect(bodyRow?.textContent).toContain('Trống');
  });

  it('nút Tháo phát ra đúng ô, nút đóng phát ra sự kiện đóng', async () => {
    fixture = await setup(equipmentWith(gearItem({ upgradeLevel: 2 })));
    const unequipped: string[] = [];
    let closedCount = 0;
    fixture.componentInstance.unequip.subscribe((slot) => unequipped.push(slot));
    fixture.componentInstance.closed.subscribe(() => {
      closedCount += 1;
    });

    (rows()[0]?.querySelector('.gear__unequip') as HTMLElement).click();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.gear__close')?.click();

    expect(unequipped).toEqual(['weapon']);
    expect(closedCount).toBe(1);
  });
});

import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { upgradeSuccessRate, upgradeYenCost, type InventoryItem } from '@ninja/shared';
import { InventoryPanel } from './inventory-panel';

/** Món ăn hồi máu: chỉ dùng được, không mặc và không cường hóa được. */
const FOOD: InventoryItem = {
  itemId: 'item-banh-bao',
  name: 'Bánh Bao Hấp',
  kind: 'consumable',
  quantity: 2,
  usable: true,
  description: 'Hồi máu',
  healHp: 40,
  slot: null,
  upgradeLevel: 0,
  stats: { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 },
  levelRequired: 1,
  price: 30,
  sellPrice: 12,
  upgradeMaxLevel: 0,
};

/** Vũ khí mặc được và cường hóa được, chỉ số đã tính cả cấp cường hóa hiện tại. */
function sword(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    itemId: 'item-kiem-go',
    name: 'Kiếm Gỗ',
    kind: 'weapon',
    quantity: 1,
    usable: false,
    description: 'Vũ khí tập luyện',
    slot: 'weapon',
    upgradeLevel: 2,
    stats: { strength: 2, agility: 1, spirit: 0, hp: 8, mp: 0 },
    levelRequired: 1,
    price: 80,
    sellPrice: 32,
    upgradeMaxLevel: 5,
    ...overrides,
  };
}

describe('InventoryPanel', () => {
  let fixture: ComponentFixture<InventoryPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(items: readonly InventoryItem[], locked = false): Promise<void> {
    await TestBed.configureTestingModule({ imports: [InventoryPanel] }).compileComponents();
    fixture = TestBed.createComponent(InventoryPanel);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('capacity', 40);
    fixture.componentRef.setInput('locked', locked);
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function rowWith(text: string): Element | undefined {
    return [...element().querySelectorAll('.bag__row')].find((row) =>
      row.textContent?.includes(text),
    );
  }

  it('món cường hóa được hiện cấp, chỉ số và nút Cường hóa kèm yên, tỉ lệ của cấp hiện tại', async () => {
    await setup([sword(), FOOD]);

    const gearRow = rowWith('Kiếm Gỗ');
    expect(gearRow?.querySelector('.bag__level')?.textContent?.trim()).toBe('+2');
    expect(gearRow?.querySelector('.bag__stats')?.textContent).toBe(
      'Sức mạnh +2 · Nhanh nhẹn +1 · Máu +8',
    );
    expect(gearRow?.querySelector('.bag__equip')?.textContent?.trim()).toBe('Mặc');

    const upgrade = gearRow?.querySelector('.bag__upgrade');
    expect(upgrade?.textContent).toContain('Cường hóa');
    // Số yên và tỉ lệ lấy từ `@ninja/shared`, đúng cấp hiện tại (2) chứ không phải cấp 0.
    expect(upgrade?.textContent).toContain(`${upgradeYenCost(2)} yên`);
    expect(upgrade?.textContent).toContain(`${Math.round(upgradeSuccessRate(2) * 100)}%`);
    expect(upgradeYenCost(2)).not.toBe(upgradeYenCost(0));
    expect((upgrade as HTMLButtonElement).disabled).toBe(false);
  });

  it('món ăn chỉ có nút Dùng, không có nút Mặc hay Cường hóa', async () => {
    await setup([FOOD]);

    const foodRow = rowWith('Bánh Bao Hấp');
    expect(foodRow?.querySelector('.bag__use')?.textContent?.trim()).toBe('Dùng');
    expect(foodRow?.querySelector('.bag__effect')?.textContent).toContain('hồi 40 máu');
    expect(foodRow?.querySelector('.bag__equip')).toBeNull();
    expect(foodRow?.querySelector('.bag__upgrade')).toBeNull();
  });

  it('món đã chạm trần cường hóa thì nút khoá và ghi Đã tối đa', async () => {
    await setup([sword({ upgradeLevel: 5 })]);

    const upgrade = rowWith('Kiếm Gỗ')?.querySelector('.bag__upgrade');
    expect(upgrade?.textContent?.trim()).toBe('Đã tối đa');
    expect((upgrade as HTMLButtonElement).disabled).toBe(true);
  });

  it('trong trận chỉ khoá nút Dùng, nút Mặc vẫn bấm được để server quyết định', async () => {
    await setup([sword(), FOOD], true);

    expect(
      (rowWith('Bánh Bao Hấp')?.querySelector('.bag__use') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((rowWith('Kiếm Gỗ')?.querySelector('.bag__equip') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('ba nút phát ra itemId của món và nút đóng phát ra sự kiện đóng', async () => {
    await setup([sword(), FOOD]);
    const used: string[] = [];
    const equipped: string[] = [];
    const upgraded: string[] = [];
    let closedCount = 0;
    fixture?.componentInstance.use.subscribe((itemId) => used.push(itemId));
    fixture?.componentInstance.equip.subscribe((itemId) => equipped.push(itemId));
    fixture?.componentInstance.upgrade.subscribe((itemId) => upgraded.push(itemId));
    fixture?.componentInstance.closed.subscribe(() => {
      closedCount += 1;
    });

    (rowWith('Bánh Bao Hấp')?.querySelector('.bag__use') as HTMLElement).click();
    (rowWith('Kiếm Gỗ')?.querySelector('.bag__equip') as HTMLElement).click();
    (rowWith('Kiếm Gỗ')?.querySelector('.bag__upgrade') as HTMLElement).click();
    element().querySelector<HTMLElement>('.bag__close')?.click();

    expect(used).toEqual(['item-banh-bao']);
    expect(equipped).toEqual(['item-kiem-go']);
    expect(upgraded).toEqual(['item-kiem-go']);
    expect(closedCount).toBe(1);
  });

  it('túi trống thì hiện lời nhắc', async () => {
    await setup([]);

    expect(element().querySelector('.bag__empty')?.textContent).toContain('Túi đang trống');
    expect(element().querySelectorAll('.bag__row')).toHaveLength(0);
  });
});

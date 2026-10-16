import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type InventoryItem, type Shop } from '@ninja/shared';
import { ShopPanel } from './shop-panel';

/** Một món trong túi để thử bảng "Bán". */
function bagItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    itemId: 'item-da-vun',
    name: 'Đá Vụn',
    kind: 'material',
    quantity: 3,
    usable: false,
    description: 'Nguyên liệu cường hóa',
    slot: null,
    upgradeLevel: 0,
    stats: { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 },
    levelRequired: 1,
    price: 5,
    sellPrice: 2,
    upgradeMaxLevel: 0,
    ...overrides,
  };
}

/** Quầy của một NPC: một vũ khí có chỉ số và một món ăn hồi máu. */
const SHOP: Shop = {
  sellRatio: 0.4,
  entries: [
    {
      itemId: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      kind: 'weapon',
      price: 80,
      sellPrice: 32,
      levelRequired: 5,
      description: 'Vũ khí tập luyện',
      slot: 'weapon',
      stats: { strength: 2, agility: 1, spirit: 0, hp: 8, mp: 0 },
      upgradeMaxLevel: 5,
    },
    {
      itemId: 'item-banh-bao',
      name: 'Bánh Bao Hấp',
      kind: 'consumable',
      price: 30,
      sellPrice: 12,
      levelRequired: 1,
      description: 'Hồi máu',
      healHp: 40,
      slot: null,
      stats: { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 },
      upgradeMaxLevel: 0,
    },
  ],
};

describe('ShopPanel', () => {
  let fixture: ComponentFixture<ShopPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(items: readonly InventoryItem[] = []): Promise<ComponentFixture<ShopPanel>> {
    await TestBed.configureTestingModule({ imports: [ShopPanel] }).compileComponents();
    const created = TestBed.createComponent(ShopPanel);
    created.componentRef.setInput('shop', SHOP);
    created.componentRef.setInput('npcName', 'Thầy Hiệu Trưởng');
    created.componentRef.setInput('items', items);
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function rowsOf(buttonClass: string): Element[] {
    return [...element().querySelectorAll('.shop__row')].filter(
      (row) => row.querySelector(buttonClass) !== null,
    );
  }

  it('bảng Mua hiện tên, giá, cấp yêu cầu và chỉ số của hàng', async () => {
    fixture = await setup();

    expect(element().querySelector('.shop__title')?.textContent).toContain('Thầy Hiệu Trưởng');
    const buyRows = rowsOf('.shop__buy');
    expect(buyRows).toHaveLength(SHOP.entries.length);

    const sword = buyRows[0];
    expect(sword?.querySelector('.shop__name')?.textContent?.trim()).toBe('Kiếm Gỗ');
    expect(sword?.querySelector('.shop__price')?.textContent?.trim()).toBe('80 yên');
    expect(sword?.querySelector('.shop__req')?.textContent?.trim()).toBe('cần cấp 5');
    expect(sword?.querySelector('.shop__note')?.textContent).toContain('Sức mạnh +2');

    // Món ăn không có chỉ số nên phần mô tả thêm nói tác dụng hồi phục.
    const food = buyRows[1];
    expect(food?.querySelector('.shop__note')?.textContent).toBe('hồi 40 máu');
  });

  it('bảng Bán lấy túi từ input, không lọc theo hàng của shop', async () => {
    // Đá Vụn không nằm trong hàng của shop nhưng vẫn phải bán được, vì túi lấy từ input.
    fixture = await setup([
      bagItem(),
      bagItem({
        itemId: 'item-banh-bao',
        name: 'Bánh Bao Hấp',
        quantity: 2,
        price: 30,
        sellPrice: 12,
      }),
    ]);

    const sellRows = rowsOf('.shop__sell');
    expect(sellRows.map((row) => row.querySelector('.shop__name')?.textContent?.trim())).toEqual([
      'Đá Vụn×3',
      'Bánh Bao Hấp×2',
    ]);
    expect(sellRows[0]?.querySelector('.shop__price')?.textContent?.trim()).toBe('2 yên');
    expect(rowsOf('.shop__buy')).toHaveLength(SHOP.entries.length);
  });

  it('túi trống thì bảng Bán nói rõ chứ không hiện dòng nào', async () => {
    fixture = await setup();

    expect(element().querySelector('.shop__empty')?.textContent).toContain('Túi đang trống');
    expect(rowsOf('.shop__sell')).toEqual([]);
  });

  it('nút Mua và nút Bán phát ra itemId, nút đóng phát ra sự kiện đóng', async () => {
    fixture = await setup([bagItem()]);
    const bought: string[] = [];
    const sold: string[] = [];
    let closedCount = 0;
    fixture.componentInstance.buy.subscribe((itemId) => bought.push(itemId));
    fixture.componentInstance.sell.subscribe((itemId) => sold.push(itemId));
    fixture.componentInstance.closed.subscribe(() => {
      closedCount += 1;
    });

    (rowsOf('.shop__buy')[0]?.querySelector('.shop__buy') as HTMLElement).click();
    (rowsOf('.shop__sell')[0]?.querySelector('.shop__sell') as HTMLElement).click();
    element().querySelector<HTMLElement>('.shop__close')?.click();

    expect(bought).toEqual(['item-kiem-go']);
    expect(sold).toEqual(['item-da-vun']);
    expect(closedCount).toBe(1);
  });
});

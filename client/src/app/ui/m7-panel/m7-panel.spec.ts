import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FIELD_BOSS_ID,
  FIELD_BOSS_MAP_ID,
  type M7State,
  M7_EVENT_ID,
  M7_EVENT_QUEST_ID,
} from '@ninja/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { M7Panel } from './m7-panel';

const state: M7State = {
  event: {
    id: M7_EVENT_ID,
    enabled: true,
    utcDay: '2026-10-22',
    loginClaimed: false,
    loginReward: { yen: 100, items: [{ itemId: 'item-banh-bao', qty: 1 }] },
    quest: {
      id: M7_EVENT_QUEST_ID,
      name: 'Hạ quái đầu tiên',
      description: 'Hạ một quái.',
      progress: 0,
      target: 1,
      complete: false,
      rewarded: false,
      reward: { yen: 250, items: [{ itemId: 'item-tra-rung', qty: 1 }] },
    },
  },
  boss: {
    id: FIELD_BOSS_ID,
    mapId: FIELD_BOSS_MAP_ID,
    name: 'Thú Vương',
    active: false,
    windowStartsAt: Date.parse('2026-10-22T10:03:00.000Z'),
    windowEndsAt: Date.parse('2026-10-22T10:04:00.000Z'),
    dailyLootClaimed: false,
    lootItemId: 'item-da-vun',
    lootQty: 1,
  },
};

describe('M7Panel', () => {
  let fixture: ComponentFixture<M7Panel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  it('renders the configured server-provided boss window in UTC', async () => {
    await TestBed.configureTestingModule({ imports: [M7Panel] }).compileComponents();
    fixture = TestBed.createComponent(M7Panel);
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2026-10-22 10:03 UTC–2026-10-22 10:04 UTC');
    expect(text).not.toContain('15 phút đầu mỗi giờ UTC');
  });

  it('renders a configured boss window that crosses UTC midnight', async () => {
    await TestBed.configureTestingModule({ imports: [M7Panel] }).compileComponents();
    fixture = TestBed.createComponent(M7Panel);
    fixture.componentRef.setInput('state', {
      ...state,
      boss: {
        ...state.boss,
        windowStartsAt: Date.parse('2026-10-22T23:59:00.000Z'),
        windowEndsAt: Date.parse('2026-10-23T00:14:00.000Z'),
      },
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2026-10-22 23:59 UTC–2026-10-23 00:14 UTC');
    expect(text).not.toContain('15 phút đầu mỗi giờ UTC');
  });

  it('shows the server-owned daily loot claim state', async () => {
    await TestBed.configureTestingModule({ imports: [M7Panel] }).compileComponents();
    fixture = TestBed.createComponent(M7Panel);
    fixture.componentRef.setInput('state', {
      ...state,
      boss: { ...state.boss, dailyLootClaimed: true },
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Bạn đã nhận vật phẩm boss hôm nay (UTC).');
    expect(text).not.toContain('Giới hạn: 1 vật phẩm / ngày UTC / nhân vật.');
  });

  it('disables the login reward claim after the server marks it claimed', async () => {
    await TestBed.configureTestingModule({ imports: [M7Panel] }).compileComponents();
    fixture = TestBed.createComponent(M7Panel);
    fixture.componentRef.setInput('state', {
      ...state,
      event: { ...state.event, loginClaimed: true },
    });
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.action');
    expect(button?.disabled).toBe(true);
    expect(button?.textContent?.trim()).toBe('Đã nhận quà hôm nay');
  });

  it('shows server-reported quest progress before completion', async () => {
    await TestBed.configureTestingModule({ imports: [M7Panel] }).compileComponents();
    fixture = TestBed.createComponent(M7Panel);
    fixture.componentRef.setInput('state', {
      ...state,
      event: {
        ...state.event,
        quest: { ...state.event.quest, progress: 0, complete: false, rewarded: false },
      },
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Tiến độ: 0 / 1 · Đang thực hiện');
    expect(text).toContain('Phần thưởng tự gửi vào hộp thư khi hoàn thành.');
  });

  it('shows the server-owned event quest completion and mailed reward', async () => {
    await TestBed.configureTestingModule({ imports: [M7Panel] }).compileComponents();
    fixture = TestBed.createComponent(M7Panel);
    fixture.componentRef.setInput('state', {
      ...state,
      event: {
        ...state.event,
        quest: { ...state.event.quest, progress: 1, complete: true, rewarded: true },
      },
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Tiến độ: 1 / 1 · Hoàn thành');
    expect(text).toContain('Thưởng đã gửi vào hộp thư.');
  });
});

import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ARENA_START_RATING,
  type ArenaEnd,
  type ArenaState as ArenaStatePayload,
  type LeaderboardEntry,
  type LeaderboardKind,
} from '@ninja/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ArenaPanel } from './arena-panel';

function arenaState(overrides: Partial<ArenaStatePayload> = {}): ArenaStatePayload {
  return {
    queued: false,
    queueSize: 0,
    rating: ARENA_START_RATING,
    wins: 0,
    losses: 0,
    ...overrides,
  };
}

function arenaEnd(overrides: Partial<ArenaEnd> = {}): ArenaEnd {
  return {
    battleId: 'btl:1',
    outcome: 'win',
    reason: 'defeat',
    ratingBefore: 1000,
    ratingAfter: 1016,
    ratingDelta: 16,
    opponentName: 'Sasuke',
    opponentRatingAfter: 984,
    wins: 1,
    losses: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return { rank: 1, name: 'Kakashi', level: 9, school: 'haruna', class: 'dao', ...overrides };
}

describe('ArenaPanel', () => {
  let fixture: ComponentFixture<ArenaPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(options: {
    state?: ArenaStatePayload;
    result?: ArenaEnd | null;
    board?: LeaderboardKind;
    entries?: readonly LeaderboardEntry[];
  }): Promise<ComponentFixture<ArenaPanel>> {
    await TestBed.configureTestingModule({ imports: [ArenaPanel] }).compileComponents();
    const created = TestBed.createComponent(ArenaPanel);
    created.componentRef.setInput('state', options.state ?? arenaState());
    created.componentRef.setInput('result', options.result ?? null);
    created.componentRef.setInput('board', options.board ?? 'level');
    created.componentRef.setInput('entries', options.entries ?? []);
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function click(selector: string): void {
    const target = element().querySelector<HTMLElement>(selector);
    expect(target, `không thấy ${selector}`).not.toBeNull();
    target?.click();
    fixture?.detectChanges();
  }

  it('hiện điểm và thành tích thắng/thua của mình', async () => {
    fixture = await setup({ state: arenaState({ rating: 1042, wins: 3, losses: 2 }) });

    expect(element().querySelector('.arena-rating')?.textContent).toContain('1042');
    const record = element().querySelector('.arena-record')?.textContent ?? '';
    expect(record).toContain('3/2');
  });

  it('chưa xếp hàng thì chỉ có nút vào hàng chờ', async () => {
    fixture = await setup({ state: arenaState({ queued: false, queueSize: 4 }) });
    let queued = 0;
    fixture.componentInstance.queue.subscribe(() => (queued += 1));

    expect(element().querySelector('.arena-cancel')).toBeNull();
    expect(element().querySelector('.arena-queue-size')?.textContent).toContain('4');

    click('.arena-queue');

    expect(queued).toBe(1);
  });

  it('đang xếp hàng thì hiện nút rời hàng chờ và không hiện nút vào hàng', async () => {
    fixture = await setup({ state: arenaState({ queued: true, queueSize: 2 }) });
    let cancelled = 0;
    fixture.componentInstance.queueCancel.subscribe(() => (cancelled += 1));

    expect(element().querySelector('.arena-queue')).toBeNull();

    click('.arena-cancel');

    expect(cancelled).toBe(1);
  });

  it('bảng cấp độ chỉ có cấp, bảng Lôi Đài có thêm điểm', async () => {
    fixture = await setup({
      board: 'level',
      entries: [entry({ rank: 1, name: 'Kakashi', level: 9 })],
    });

    expect(element().querySelectorAll('.arena-entry')).toHaveLength(1);
    expect(element().querySelector('.arena-entry__rank')?.textContent?.trim()).toBe('1');
    expect(element().querySelector('.arena-entry__level')?.textContent).toContain('9');
    expect(element().querySelector('.arena-entry__rating')).toBeNull();

    fixture.componentRef.setInput('board', 'arena');
    fixture.componentRef.setInput('entries', [entry({ rating: 1200 })]);
    fixture.detectChanges();

    expect(element().querySelector('.arena-entry__rating')?.textContent?.trim()).toBe('1200');
  });

  it('bảng rỗng thì hiện đúng dòng --empty thay vì danh sách trắng', async () => {
    fixture = await setup({ entries: [] });

    expect(element().querySelector('.arena-entry--empty')).not.toBeNull();
    expect(element().querySelectorAll('.arena-entry:not(.arena-entry--empty)')).toHaveLength(0);
  });

  it('bấm thẻ bảng khác thì xin bảng đó, bấm lại thẻ đang xem thì không gửi gì', async () => {
    fixture = await setup({ board: 'level', entries: [entry()] });
    const requested: LeaderboardKind[] = [];
    fixture.componentInstance.boardChange.subscribe((board) => requested.push(board));

    click('.arena-board-tab--arena');
    click('.arena-board-tab--level');

    // Thẻ đang sáng là bảng đang xem: bấm lại không phải là yêu cầu mới.
    expect(requested).toEqual(['arena']);
  });

  it('kết quả trận thắng hiện chữ Thắng, điểm cộng có dấu và điểm mới', async () => {
    fixture = await setup({ result: arenaEnd() });

    expect(element().querySelector('.arena-result')).not.toBeNull();
    expect(element().querySelector('.arena-result__title')?.textContent).toContain('Thắng');
    expect(element().querySelector('.arena-result__title')?.textContent).toContain('Sasuke');
    expect(element().querySelector('.arena-result__delta')?.textContent?.trim()).toBe('+16');
    expect(element().querySelector('.arena-result__rating')?.textContent?.trim()).toBe('1016');
  });

  it('kết quả trận thua hiện chữ Thua và điểm trừ', async () => {
    fixture = await setup({
      result: arenaEnd({ outcome: 'loss', ratingDelta: -16, ratingAfter: 984, wins: 0, losses: 1 }),
    });

    expect(element().querySelector('.arena-result__title')?.textContent).toContain('Thua');
    expect(element().querySelector('.arena-result__delta')?.textContent?.trim()).toBe('-16');
  });

  it('đóng kết quả thì phát `resultClosed`, đóng cả bảng thì phát `closed`', async () => {
    fixture = await setup({ result: arenaEnd() });
    let resultClosed = 0;
    let closed = 0;
    fixture.componentInstance.resultClosed.subscribe(() => (resultClosed += 1));
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    click('.arena-result__close');
    click('.arena-panel__close');

    expect(resultClosed).toBe(1);
    expect(closed).toBe(1);
  });
});

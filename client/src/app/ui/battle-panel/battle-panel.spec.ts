import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { BATTLE_TURN_MS, type Combatant } from '@ninja/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { BattleSnapshot } from '../../net/battle-state';
import { BattlePanel, type BattleActionRequest } from './battle-panel';

function combatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'p1',
    kind: 'player',
    name: 'Kakashi',
    level: 1,
    hp: 60,
    maxHp: 60,
    mp: 40,
    maxMp: 40,
    attack: 13,
    defense: 2,
    speed: 6,
    alive: true,
    ...overrides,
  };
}

const SELF = combatant({ id: 'p1', name: 'Kakashi' });
const OPPONENT = combatant({ id: 'p2', name: 'Sasuke' });
const MONSTER = combatant({ id: 'mob:1', kind: 'monster', name: 'Chuột Đồng' });

function snapshot(overrides: Partial<BattleSnapshot> = {}): BattleSnapshot {
  return {
    battleId: 'btl:1',
    roundNo: 1,
    actorId: 'p1',
    turnMs: BATTLE_TURN_MS,
    turnEndsAt: Date.now() + BATTLE_TURN_MS,
    participants: [SELF, OPPONENT],
    mode: 'arena',
    ...overrides,
  };
}

describe('BattlePanel', () => {
  let fixture: ComponentFixture<BattlePanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(battle: BattleSnapshot | null): Promise<ComponentFixture<BattlePanel>> {
    await TestBed.configureTestingModule({ imports: [BattlePanel] }).compileComponents();
    const created = TestBed.createComponent(BattlePanel);
    created.componentRef.setInput('battle', battle);
    created.componentRef.setInput('selfId', 'p1');
    created.componentRef.setInput('isMyTurn', true);
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  it('trận đánh quái giữ tiêu đề thường và có nút bỏ chạy', async () => {
    fixture = await setup(snapshot({ mode: 'pve', participants: [MONSTER, SELF], actorId: 'p1' }));

    expect(element().querySelector('.battle__mode')?.textContent?.trim()).toBe('Đánh quái');
    expect(element().querySelector('.btn--flee')).not.toBeNull();
    expect(element().querySelector('.card--opponent')).toBeNull();
  });

  it('trận Lôi Đài ghi tiêu đề "Lôi Đài" và ẩn nút bỏ chạy', async () => {
    fixture = await setup(snapshot({ mode: 'arena', participants: [SELF, OPPONENT] }));

    expect(element().querySelector('.battle__mode')?.textContent?.trim()).toBe('Lôi Đài');
    // Luật Lôi Đài không cho bỏ chạy hoặc dùng vật phẩm: nút không được có mặt để người chơi khỏi
    // bấm rồi ăn lỗi server.
    expect(element().querySelector('.btn--flee')).toBeNull();
    expect(element().querySelector('.battle__actions')?.textContent).not.toContain('Dùng vật phẩm');
    expect(element().querySelector('.items')).toBeNull();
  });

  it('trận Lôi Đài đánh dấu thẻ đối thủ, không đánh dấu thẻ của mình', async () => {
    fixture = await setup(snapshot({ mode: 'arena', participants: [SELF, OPPONENT] }));

    const cards = [...element().querySelectorAll<HTMLElement>('.card')];
    const selfCard = cards.find((card) => card.textContent?.includes('Kakashi'));
    const opponentCard = cards.find((card) => card.textContent?.includes('Sasuke'));

    expect(selfCard?.className).toContain('card--self');
    expect(selfCard?.className).not.toContain('card--opponent');
    expect(opponentCard?.className).toContain('card--opponent');
  });

  it('nút tấn công vẫn phát hành động như cũ trong trận Lôi Đài', async () => {
    fixture = await setup(snapshot({ mode: 'arena' }));
    const actions: BattleActionRequest[] = [];
    fixture.componentInstance.action.subscribe((action) => actions.push(action));

    element().querySelector<HTMLElement>('.btn--primary')?.click();
    fixture.detectChanges();

    // Server định tuyến theo `battleId`, client không cần biết đây là trận Lôi Đài.
    expect(actions).toEqual([{ action: 'attack' }]);
  });
});

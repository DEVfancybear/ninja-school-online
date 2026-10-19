import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type NpcDialog, type QuestObjectiveView, type QuestView } from '@ninja/shared';
import { NpcDialogPanel, type NpcDialogOption } from './npc-dialog';

function objective(overrides: Partial<QuestObjectiveView> = {}): QuestObjectiveView {
  return {
    kind: 'kill',
    targetId: 'mob-bui-nhon',
    description: 'Đánh hạ 2 Bù Nhìn Tập Luyện',
    count: 2,
    progress: 1,
    done: false,
    ...overrides,
  };
}

function questView(overrides: Partial<QuestView> = {}): QuestView {
  return {
    questId: 'quest-bai-hoc-dau-tien',
    name: 'Bài học đầu tiên',
    summary: 'Bù Nhìn Tập Luyện ở Bãi Luyện Tập là thầy dạy đầu tiên.',
    chapter: 1,
    state: 'available',
    giverNpcId: 'npc-thay-hieu-truong',
    giverName: 'Thầy Hiệu Trưởng',
    turnInNpcId: 'npc-thay-hieu-truong',
    turnInName: 'Thầy Hiệu Trưởng',
    levelRequired: 2,
    objectives: [objective()],
    rewards: { exp: 60, yen: 80, items: [] },
    unlocks: [],
    ...overrides,
  };
}

function npcDialog(overrides: Partial<NpcDialog> = {}): NpcDialog {
  return {
    npcId: 'npc-thay-hieu-truong',
    npcName: 'Thầy Hiệu Trưởng',
    lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Con tới bãi tập luyện đi.' }],
    nodeId: 'node-goc',
    options: [],
    shop: null,
    quests: [],
    ...overrides,
  };
}

const RECRUIT_OPTION: NpcDialogOption = {
  id: 'opt-nhan',
  text: 'Con muốn nhận nhiệm vụ',
  next: 'node-nhan',
};
const LEAVE_OPTION: NpcDialogOption = {
  id: 'opt-thoi',
  text: 'Để con suy nghĩ thêm',
  next: null,
};

describe('NpcDialogPanel', () => {
  let fixture: ComponentFixture<NpcDialogPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(dialog: NpcDialog): Promise<ComponentFixture<NpcDialogPanel>> {
    await TestBed.configureTestingModule({ imports: [NpcDialogPanel] }).compileComponents();
    const created = TestBed.createComponent(NpcDialogPanel);
    created.componentRef.setInput('dialog', dialog);
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  it('hiện từng lựa chọn hội thoại và phát ra đúng lựa chọn khi bấm', async () => {
    fixture = await setup(npcDialog({ options: [RECRUIT_OPTION, LEAVE_OPTION] }));
    const chosen: NpcDialogOption[] = [];
    let closedCount = 0;
    fixture.componentInstance.optionChosen.subscribe((option) => chosen.push(option));
    fixture.componentInstance.closed.subscribe(() => {
      closedCount += 1;
    });

    expect(
      [...element().querySelectorAll<HTMLElement>('.npc-option')].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(['Con muốn nhận nhiệm vụ', 'Để con suy nghĩ thêm']);

    const [recruit, leave] = [...element().querySelectorAll<HTMLElement>('.npc-option')];
    recruit?.click();

    expect(chosen).toEqual([RECRUIT_OPTION]);
    // `next` còn nhánh nữa thì hộp thoại phải ở lại để người chơi đọc tiếp.
    expect(closedCount).toBe(0);

    leave?.click();

    expect(chosen).toEqual([RECRUIT_OPTION, LEAVE_OPTION]);
    expect(closedCount).toBe(1);
  });

  it('nhiệm vụ nhận được: hiện mục tiêu, thưởng, nút Nhận nhiệm vụ và phát ra questId khi bấm', async () => {
    fixture = await setup(
      npcDialog({
        quests: [
          questView({
            state: 'available',
            objectives: [
              objective({ progress: 0 }),
              objective({
                targetId: 'mob-chuot-dong',
                description: 'Đánh hạ 3 Chuột Đồng',
                count: 3,
                progress: 0,
              }),
            ],
            rewards: {
              exp: 60,
              yen: 80,
              items: [{ itemId: 'item-banh-bao', name: 'Bánh Bao Hấp', quantity: 1 }],
            },
          }),
        ],
      }),
    );
    const accepted: string[] = [];
    fixture.componentInstance.accept.subscribe((questId) => accepted.push(questId));

    const cards = element().querySelectorAll('.npc-quest');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.querySelector('.npc-quest__name')?.textContent?.trim()).toBe(
      'Bài học đầu tiên',
    );
    expect(
      [...(cards[0]?.querySelectorAll('.npc-quest__objective') ?? [])].map((row) =>
        row.textContent?.trim(),
      ),
    ).toEqual(['Đánh hạ 2 Bù Nhìn Tập Luyện (0/2)', 'Đánh hạ 3 Chuột Đồng (0/3)']);
    expect(cards[0]?.querySelector('.npc-quest__rewards')?.textContent).toContain(
      '60 kinh nghiệm · 80 yên · 1 Bánh Bao Hấp',
    );
    expect(cards[0]?.querySelector('.npc-quest__complete')).toBeNull();

    const accept = cards[0]?.querySelector<HTMLElement>('.npc-quest__accept');
    expect(accept?.textContent?.trim()).toBe('Nhận nhiệm vụ');
    accept?.click();

    expect(accepted).toEqual(['quest-bai-hoc-dau-tien']);
  });

  it('nhiệm vụ đã xong mục tiêu: chỉ có nút Trả nhiệm vụ', async () => {
    fixture = await setup(
      npcDialog({
        quests: [
          questView({ state: 'ready', objectives: [objective({ progress: 2, done: true })] }),
        ],
      }),
    );
    const completed: string[] = [];
    fixture.componentInstance.complete.subscribe((questId) => completed.push(questId));

    const card = element().querySelector('.npc-quest');
    expect(card?.querySelector('.npc-quest__accept')).toBeNull();
    expect(card?.querySelector('.npc-quest__hint')).toBeNull();

    const complete = card?.querySelector<HTMLElement>('.npc-quest__complete');
    expect(complete?.textContent?.trim()).toBe('Trả nhiệm vụ');
    complete?.click();

    expect(completed).toEqual(['quest-bai-hoc-dau-tien']);
  });

  it('nhiệm vụ đang làm: nhắc chưa xong và không có nút nào', async () => {
    fixture = await setup(npcDialog({ quests: [questView({ state: 'active' })] }));

    const card = element().querySelector('.npc-quest');
    expect(card?.querySelector('.npc-quest__hint')?.textContent?.trim()).toBe('Chưa xong mục tiêu');
    expect(card?.querySelector('.npc-quest__accept')).toBeNull();
    expect(card?.querySelector('.npc-quest__complete')).toBeNull();
  });

  it('giữ nguyên lời thoại và nút đóng cũ', async () => {
    fixture = await setup(npcDialog({ options: [RECRUIT_OPTION] }));
    let closedCount = 0;
    fixture.componentInstance.closed.subscribe(() => {
      closedCount += 1;
    });

    expect(element().querySelector('.npc-line .npc-text')?.textContent?.trim()).toBe(
      'Con tới bãi tập luyện đi.',
    );

    element().querySelector<HTMLElement>('.npc-close')?.click();

    expect(closedCount).toBe(1);
  });
});

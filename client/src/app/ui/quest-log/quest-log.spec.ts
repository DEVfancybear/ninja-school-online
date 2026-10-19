import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAX_ACTIVE_QUESTS,
  type QuestObjectiveView,
  type QuestUpdate,
  type QuestView,
} from '@ninja/shared';
import { QuestLog } from './quest-log';

/** Một mục tiêu như server gửi: chữ mô tả soạn sẵn, tiến độ đã tính sẵn. */
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

/** Một nhiệm vụ theo góc nhìn người chơi. */
function questView(overrides: Partial<QuestView> = {}): QuestView {
  return {
    questId: 'quest-bai-hoc-dau-tien',
    name: 'Bài học đầu tiên',
    summary: 'Bù Nhìn Tập Luyện ở Bãi Luyện Tập là thầy dạy đầu tiên.',
    chapter: 1,
    state: 'active',
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

function questUpdate(overrides: Partial<QuestUpdate> = {}): QuestUpdate {
  return {
    active: [],
    available: [],
    completed: [],
    unlockedFeatures: [],
    maxActive: MAX_ACTIVE_QUESTS,
    ...overrides,
  };
}

describe('QuestLog', () => {
  let fixture: ComponentFixture<QuestLog> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(quests: QuestUpdate): Promise<ComponentFixture<QuestLog>> {
    await TestBed.configureTestingModule({ imports: [QuestLog] }).compileComponents();
    const created = TestBed.createComponent(QuestLog);
    created.componentRef.setInput('quests', quests);
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function questRows(): Element[] {
    return [...element().querySelectorAll('.quest-log__quest')];
  }

  it('hiện tên, từng mục tiêu kèm tiến độ và lời nhắc trả nhiệm vụ khi xong mục tiêu', async () => {
    fixture = await setup(
      questUpdate({
        active: [
          questView(),
          questView({
            questId: 'quest-chao-lang',
            name: 'Chào làng',
            // Server đã suy ra `ready`, còn tiến độ từng mục tiêu cũng đã đủ.
            state: 'ready',
            objectives: [
              objective({
                kind: 'talk',
                targetId: 'npc-thay-do',
                description: 'Ghé chào Thầy Đồ',
                count: 1,
                progress: 1,
                done: true,
              }),
            ],
          }),
        ],
      }),
    );

    expect(element().querySelector('.quest-log__title')?.textContent?.trim()).toBe(
      'Nhật ký nhiệm vụ',
    );
    expect(questRows()).toHaveLength(2);
    expect(
      questRows().map((row) => row.querySelector('.quest-log__name')?.textContent?.trim()),
    ).toEqual(['Bài học đầu tiên', 'Chào làng']);
    expect(questRows()[0]?.querySelector('.quest-log__objective')?.textContent?.trim()).toBe(
      'Đánh hạ 2 Bù Nhìn Tập Luyện (1/2)',
    );

    // Nhiệm vụ đầu chưa xong mục tiêu nên không có lời nhắc trả.
    expect(questRows()[0]?.querySelector('.quest-log__ready')).toBeNull();
    expect(questRows()[1]?.querySelector('.quest-log__ready')?.textContent?.trim()).toBe(
      'về trả nhiệm vụ cho Thầy Hiệu Trưởng',
    );
  });

  it('coi là xong khi mọi mục tiêu đã đạt, kể cả lúc state còn là active', async () => {
    fixture = await setup(
      questUpdate({
        active: [
          questView({
            state: 'active',
            objectives: [
              objective({ done: true, progress: 2 }),
              objective({
                targetId: 'mob-chuot-dong',
                description: 'Đánh hạ 3 Chuột Đồng',
                count: 3,
                progress: 3,
                done: true,
              }),
            ],
          }),
        ],
      }),
    );

    // Mục tiêu đã xong hết thì nhật ký phải chỉ chỗ trả, dù `state` có lệch đi nữa.
    expect(questRows()[0]?.querySelector('.quest-log__ready')?.textContent?.trim()).toBe(
      'về trả nhiệm vụ cho Thầy Hiệu Trưởng',
    );
  });

  it('liệt kê nhiệm vụ có thể nhận kèm người giao', async () => {
    fixture = await setup(
      questUpdate({
        available: [
          {
            questId: 'quest-chao-lang',
            name: 'Chào làng',
            giverNpcId: 'npc-thay-hieu-truong',
            giverName: 'Thầy Hiệu Trưởng',
            turnInNpcId: 'npc-thay-hieu-truong',
            turnInName: 'Thầy Hiệu Trưởng',
            levelRequired: 1,
          },
          {
            questId: 'quest-nhat-da-vun',
            name: 'Nhặt đá vụn',
            giverNpcId: 'npc-thay-do',
            giverName: 'Thầy Đồ',
            turnInNpcId: 'npc-thay-do',
            turnInName: 'Thầy Đồ',
            levelRequired: 2,
          },
        ],
      }),
    );

    expect(
      [...element().querySelectorAll('.quest-log__available-item')].map((row) =>
        row.textContent?.trim(),
      ),
    ).toEqual(['Chào làng — gặp Thầy Hiệu Trưởng', 'Nhặt đá vụn — gặp Thầy Đồ']);
  });

  it('đếm số nhiệm vụ đã xong, số đang làm trên trần và hiện cờ mở khóa bằng nhãn tiếng Việt', async () => {
    fixture = await setup(
      questUpdate({
        active: [questView()],
        completed: ['quest-chao-lang', 'quest-bai-hoc-dau-tien'],
        unlockedFeatures: ['party', 'arena', 'feature-la'],
      }),
    );

    const count = element().querySelector('.quest-log__count')?.textContent ?? '';
    expect(count).toContain('Đã xong 2 nhiệm vụ');
    expect(count).toContain(`Đang làm 1/${MAX_ACTIVE_QUESTS}`);

    // Cờ lạ hiện nguyên id để còn lần ra dữ liệu, không nuốt mất.
    expect(element().querySelector('.quest-log__features')?.textContent).toContain(
      'Lập nhóm, Lôi Đài, feature-la',
    );
  });

  it('chưa có gì thì nói rõ đang trống chứ không vẽ dòng nào', async () => {
    fixture = await setup(questUpdate());

    expect(questRows()).toEqual([]);
    expect([...element().querySelectorAll('.quest-log__available-item')]).toEqual([]);
    expect(element().textContent).toContain('Chưa nhận nhiệm vụ nào');
    expect(element().textContent).toContain('Chưa có nhiệm vụ nào để nhận thêm');
    expect(element().querySelector('.quest-log__features')).toBeNull();
  });

  it('bấm nút đóng thì phát sự kiện đóng', async () => {
    fixture = await setup(questUpdate());
    let closedCount = 0;
    fixture.componentInstance.closed.subscribe(() => {
      closedCount += 1;
    });

    element().querySelector<HTMLElement>('.quest-log__close')?.click();

    expect(closedCount).toBe(1);
  });
});

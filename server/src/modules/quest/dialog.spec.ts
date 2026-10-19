import { describe, expect, it } from 'vitest';
import { NpcSchema, type Npc, type NpcDialogNode, type QuestViewState } from '@ninja/shared';
import { pickDialogNode } from './dialog.js';

const HEADMASTER = 'npc-thay-hieu-truong';

/** NPC tối thiểu nhưng hợp lệ theo `game-data`: mọi nhánh đều dựng trong từng bài test. */
function npc(dialog: NpcDialogNode[]): Npc {
  return NpcSchema.parse({
    id: HEADMASTER,
    name: 'Thầy Hiệu Trưởng',
    color: '#f2c14e',
    lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Chào con, khỏe không?' }],
    dialog,
    shop: [],
  });
}

function node(id: string, when: NpcDialogNode['when'], lines = `nhánh ${id}`): NpcDialogNode {
  return { id, when, lines: [{ speaker: 'Thầy Hiệu Trưởng', text: lines }], options: [] };
}

function facts(questStates: Record<string, QuestViewState> = {}, level = 1) {
  return { questStates: new Map(Object.entries(questStates)), level };
}

describe('pickDialogNode', () => {
  it('chọn nhánh đầu tiên khớp và bỏ qua các nhánh sau cũng khớp', () => {
    const teacher = npc([
      node(
        'nhan-chao-lang',
        { questId: 'quest-chao-lang', state: 'available' },
        'Con đi chào làng đi.',
      ),
      node(
        'nhan-chao-lang-lan-hai',
        { questId: 'quest-chao-lang', state: 'available' },
        'Nhắc lại lần hai.',
      ),
      node('nhan-viec-khac', { levelAtLeast: 1 }, 'Việc khác.'),
    ]);

    const chosen = pickDialogNode(teacher, facts({ 'quest-chao-lang': 'available' }));
    expect(chosen?.id).toBe('nhan-chao-lang');
    expect(chosen?.lines[0]?.text).toBe('Con đi chào làng đi.');
  });

  it('nhánh không có `when` không bao giờ tự chọn — chỉ tới được bằng `next`', () => {
    const teacher = npc([node('ke-ve-thay-do', undefined, 'Chuyện tiếp theo.')]);
    expect(pickDialogNode(teacher, facts({ 'quest-chao-lang': 'active' }))).toBeUndefined();
  });

  it('không nhánh nào khớp thì trả undefined để NPC dùng `lines` mặc định', () => {
    const teacher = npc([node('tra-chao-lang', { questId: 'quest-chao-lang', state: 'ready' })]);
    expect(pickDialogNode(teacher, facts({ 'quest-chao-lang': 'active' }))).toBeUndefined();
    expect(pickDialogNode(teacher, facts())).toBeUndefined();
  });

  it('nhiệm vụ chưa mở (không có trong bảng trạng thái) làm nhánh không khớp', () => {
    const teacher = npc([
      node('giao-bao-boi', { questId: 'quest-bao-boi-dau-tien', state: 'available' }),
    ]);
    // Nhân vật chưa đủ điều kiện nên `dialogStates` không trả về nhiệm vụ đó.
    expect(pickDialogNode(teacher, facts())).toBeUndefined();
    expect(pickDialogNode(teacher, facts({ 'quest-bao-boi-dau-tien': 'available' }))?.id).toBe(
      'giao-bao-boi',
    );
  });

  it('nhánh sau vẫn được chọn khi nhánh trước không khớp', () => {
    const teacher = npc([
      node(
        'giao-bai-hoc',
        { questId: 'quest-bai-hoc-dau-tien', state: 'active' },
        'Đi đánh bù nhìn đi.',
      ),
      node(
        'thuong-bai-hoc',
        { questId: 'quest-bai-hoc-dau-tien', state: 'ready' },
        'Xong rồi hả con?',
      ),
    ]);

    expect(pickDialogNode(teacher, facts({ 'quest-bai-hoc-dau-tien': 'active' }))?.id).toBe(
      'giao-bai-hoc',
    );
    expect(pickDialogNode(teacher, facts({ 'quest-bai-hoc-dau-tien': 'ready' }))?.id).toBe(
      'thuong-bai-hoc',
    );
  });

  it('`levelAtLeast` phải đủ cấp, thiếu một cấp là rơi về `lines` mặc định', () => {
    const teacher = npc([node('giao-bai-su', { levelAtLeast: 3 }, 'Đủ trình rồi, gặp Sư Phụ đi.')]);

    expect(pickDialogNode(teacher, facts({}, 2))).toBeUndefined();
    expect(pickDialogNode(teacher, facts({}, 3))?.id).toBe('giao-bai-su');
  });

  it('nhiều điều kiện trong cùng `when` phải cùng đúng', () => {
    const teacher = npc([
      node(
        'giao-bai-su',
        { questId: 'quest-loi-thay-day', state: 'completed', levelAtLeast: 3 },
        'Con tới gặp Sư Phụ.',
      ),
    ]);

    expect(pickDialogNode(teacher, facts({ 'quest-loi-thay-day': 'completed' }, 3))?.id).toBe(
      'giao-bai-su',
    );
    expect(
      pickDialogNode(teacher, facts({ 'quest-loi-thay-day': 'completed' }, 2)),
    ).toBeUndefined();
    expect(pickDialogNode(teacher, facts({ 'quest-loi-thay-day': 'active' }, 3))).toBeUndefined();
    expect(pickDialogNode(teacher, facts({}, 9))).toBeUndefined();
  });

  it('`when` chỉ có `state` mà không nói nhiệm vụ nào thì không khớp (dữ liệu hỏng)', () => {
    const broken = npc([
      {
        id: 'nhan-bua',
        when: { state: 'available' },
        lines: [{ speaker: 'ai', text: 'bừa' }],
        options: [],
      },
    ]);
    expect(pickDialogNode(broken, facts({ 'quest-chao-lang': 'available' }))).toBeUndefined();
  });
});

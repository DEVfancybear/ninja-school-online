import { describe, expect, it } from 'vitest';
import {
  checkGameData,
  GameMapSchema,
  ItemSchema,
  MonsterSchema,
  NpcSchema,
  QuestSchema,
  type GameDataSet,
  type GameMap,
  type Item,
  type Monster,
  type Npc,
  type Quest,
} from '../index.js';

const map: GameMap = GameMapSchema.parse({
  id: 'lang-khoi-nguon',
  name: 'Làng Khởi Nguồn',
  width: 8,
  height: 8,
  tiles: [{ id: 0, name: 'cỏ', color: '#2f5d3a' }],
  ground: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0)),
  spawns: [{ id: 'default', x: 4, y: 4 }],
});

const npc: Npc = NpcSchema.parse({
  id: 'npc-thay-do',
  name: 'Thầy Đồ',
  color: '#c98a2b',
  lines: [{ speaker: 'Thầy Đồ', text: 'Ghé xem hàng của thầy đi.' }],
});

const monster: Monster = MonsterSchema.parse({
  id: 'mob-chuot-dong',
  name: 'Chuột Đồng',
  shape: 'rodent',
  color: '#8b6f4e',
  level: 1,
  maxHp: 40,
  attack: 5,
  defense: 1,
  speed: 4,
  expReward: 140,
  yenMin: 8,
  yenMax: 18,
});

const item: Item = ItemSchema.parse({
  id: 'item-da-vun',
  name: 'Đá Vụn',
  kind: 'material',
  levelRequired: 1,
  price: 5,
});

const quest: Quest = QuestSchema.parse({
  id: 'quest-chao-lang',
  name: 'Chào làng',
  summary: 'Ghé chào Thầy Đồ.',
  giverNpcId: 'npc-thay-do',
  turnInNpcId: 'npc-thay-do',
  objectives: [{ kind: 'talk', targetId: 'npc-thay-do', description: 'Ghé chào Thầy Đồ' }],
  rewards: { exp: 30, yen: 50 },
});

function gameData(overrides: Partial<GameDataSet> = {}): GameDataSet {
  return {
    maps: [map],
    npcs: [npc],
    monsters: [monster],
    skills: [],
    items: [item],
    classes: [],
    quests: [quest],
    ...overrides,
  };
}

function messages(data: GameDataSet): string[] {
  return checkGameData(data).map((issue) => `${issue.file}#${issue.path}: ${issue.message}`);
}

describe('QuestSchema', () => {
  it('điền mặc định cho nhiệm vụ tối thiểu', () => {
    expect(quest.chapter).toBe(1);
    expect(quest.levelRequired).toBe(1);
    expect(quest.requiresQuests).toEqual([]);
    expect(quest.unlocks).toEqual([]);
    expect(quest.objectives[0]?.count).toBe(1);
  });

  it('từ chối nhiệm vụ không có mục tiêu nào', () => {
    expect(() => QuestSchema.parse({ ...quest, objectives: [] })).toThrow();
  });

  it('từ chối id nhiệm vụ sai định dạng', () => {
    expect(() => QuestSchema.parse({ ...quest, id: 'chao-lang' })).toThrow();
  });

  it('từ chối loại mục tiêu lạ', () => {
    expect(() =>
      QuestSchema.parse({
        ...quest,
        objectives: [{ kind: 'craft', targetId: 'item-da-vun', description: 'Chế đồ' }],
      }),
    ).toThrow();
  });
});

describe('cây hội thoại NPC', () => {
  const withDialog = (dialog: unknown): Npc =>
    NpcSchema.parse({
      id: 'npc-su-phu',
      name: 'Sư Phụ',
      color: '#6f7fd6',
      lines: [{ speaker: 'Sư Phụ', text: 'Ta là Sư Phụ.' }],
      dialog,
    });

  it('nhận nhánh có điều kiện và lựa chọn đi tiếp', () => {
    const parsed = withDialog([
      {
        id: 'bai-su',
        when: { questId: 'quest-chao-lang', state: 'ready' },
        lines: [{ speaker: 'Sư Phụ', text: 'Con đã sẵn sàng chưa?' }],
        options: [{ id: 'xin-bai-su', text: 'Con xin bái sư', next: 'le-bai-su' }],
      },
      { id: 'le-bai-su', lines: [{ speaker: 'Sư Phụ', text: 'Từ hôm nay con là đệ tử.' }] },
    ]);
    expect(parsed.dialog).toHaveLength(2);
    expect(parsed.dialog[0]?.options[0]?.next).toBe('le-bai-su');
  });

  it('từ chối trạng thái nhiệm vụ không có thật', () => {
    expect(() =>
      withDialog([
        {
          id: 'sai',
          when: { questId: 'quest-chao-lang', state: 'dang-lam' },
          lines: [{ speaker: 'Sư Phụ', text: 'Sai trạng thái.' }],
        },
      ]),
    ).toThrow();
  });
});

describe('checkGameData với nhiệm vụ', () => {
  it('dữ liệu hợp lệ thì không có lỗi', () => {
    expect(messages(gameData())).toEqual([]);
  });

  it('báo lỗi khi nhiệm vụ trỏ tới NPC không tồn tại', () => {
    const issues = messages(gameData({ quests: [{ ...quest, giverNpcId: 'npc-khong-co' }] }));
    expect(issues).toEqual([
      'quests/quest-chao-lang.json#giverNpcId: nhiệm vụ trỏ tới NPC "npc-khong-co" nhưng không có file trong game-data/npcs/',
    ]);
  });

  it('báo lỗi khi mục tiêu trỏ tới quái không tồn tại', () => {
    const issues = messages(
      gameData({
        quests: [
          {
            ...quest,
            objectives: [
              { kind: 'kill', targetId: 'mob-khong-co', count: 2, description: 'Đánh hạ quái' },
            ],
          },
        ],
      }),
    );
    expect(issues[0]).toContain('mục tiêu đánh hạ quái "mob-khong-co" không tồn tại');
  });

  it('báo lỗi khi quà thưởng không có file vật phẩm', () => {
    const issues = messages(
      gameData({
        quests: [
          {
            ...quest,
            rewards: { exp: 1, yen: 1, items: [{ itemId: 'item-khong-co', quantity: 1 }] },
          },
        ],
      }),
    );
    expect(issues[0]).toContain('quà thưởng "item-khong-co" không có file trong game-data/items/');
  });

  it('báo lỗi khi nhiệm vụ phải trước không tồn tại', () => {
    const issues = messages(
      gameData({ quests: [{ ...quest, requiresQuests: ['quest-khong-co'] }] }),
    );
    expect(issues[0]).toContain('nhiệm vụ phải trước "quest-khong-co" không tồn tại');
  });

  it('báo lỗi khi hai nhiệm vụ yêu cầu lẫn nhau', () => {
    const other: Quest = { ...quest, id: 'quest-thu-hai', requiresQuests: [quest.id] };
    const issues = messages(
      gameData({ quests: [{ ...quest, requiresQuests: [other.id] }, other] }),
    );
    expect(issues.some((issue) => issue.includes('vòng nhiệm vụ'))).toBe(true);
  });

  it('báo lỗi khi nhiệm vụ yêu cầu chính nó', () => {
    const issues = messages(gameData({ quests: [{ ...quest, requiresQuests: [quest.id] }] }));
    expect(issues[0]).toContain('không thể yêu cầu chính nó');
  });

  it('báo lỗi khi hai file nhiệm vụ trùng id', () => {
    const issues = messages(gameData({ quests: [quest, { ...quest }] }));
    expect(issues[0]).toContain('bị khai báo ở nhiều file');
  });

  it('báo lỗi khi lựa chọn hội thoại dẫn tới nhánh không có', () => {
    const suPhu = NpcSchema.parse({
      id: 'npc-su-phu',
      name: 'Sư Phụ',
      color: '#6f7fd6',
      lines: [{ speaker: 'Sư Phụ', text: 'Ta là Sư Phụ.' }],
      dialog: [
        {
          id: 'mo-dau',
          when: { questId: 'quest-chao-lang', state: 'ready' },
          lines: [{ speaker: 'Sư Phụ', text: 'Con đã sẵn sàng chưa?' }],
          options: [{ id: 'di-tiep', text: 'Vâng', next: 'khong-co' }],
        },
      ],
    });
    const issues = messages(gameData({ npcs: [npc, suPhu] }));
    expect(issues[0]).toContain(
      'lựa chọn dẫn tới nhánh "khong-co" không có trong hội thoại của NPC này',
    );
  });

  it('báo lỗi khi nhánh nói về nhiệm vụ không tồn tại', () => {
    const suPhu = NpcSchema.parse({
      id: 'npc-su-phu',
      name: 'Sư Phụ',
      color: '#6f7fd6',
      lines: [{ speaker: 'Sư Phụ', text: 'Ta là Sư Phụ.' }],
      dialog: [
        {
          id: 'mo-dau',
          when: { questId: 'quest-khong-co', state: 'ready' },
          lines: [{ speaker: 'Sư Phụ', text: 'Con đã sẵn sàng chưa?' }],
        },
      ],
    });
    const issues = messages(gameData({ npcs: [npc, suPhu] }));
    expect(issues[0]).toContain('nhưng nhiệm vụ đó không tồn tại');
  });
});

import { TestBed } from '@angular/core/testing';
import {
  EQUIP_SLOTS,
  Opcode,
  TICK_RATE_MS,
  type CharacterStats,
  type Entity,
  type EquipmentUpdate,
  type InventoryItem,
  type InventoryUpdate,
  type LevelUp,
  type MapSnapshot,
  type ServerEnterMap,
} from '@ninja/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHAT_LOG_LIMIT, WorldState } from './world-state';

const MAP: MapSnapshot = {
  id: 'lang-khoi-nguon',
  name: 'Làng Khởi Nguồn',
  width: 3,
  height: 2,
  tileSize: 32,
  tiles: [
    { id: 1, color: '#3b6b3f', blocked: false },
    { id: 2, color: '#556655', blocked: true },
  ],
  ground: [
    [1, 1, 1],
    [1, 2, 1],
  ],
  decor: [
    [-1, -1, -1],
    [-1, -1, -1],
  ],
};

function entity(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  return { id, kind: 'player', name, color: '#ff8844', x: 0, y: 0, ...overrides };
}

function enterMap(overrides: Partial<ServerEnterMap> = {}): ServerEnterMap {
  return {
    map: MAP,
    entity: entity('p1', 'Kakashi', { x: 16, y: 16 }),
    entities: [entity('npc1', 'Thầy Hiệu Trưởng', { kind: 'npc', x: 64, y: 32 })],
    chatBacklog: [{ channel: 'map', fromName: 'Kakashi', text: 'xin chào', at: 10 }],
    ...overrides,
  };
}

/** Một món trong túi với đủ trường của hợp đồng M4 (`slot`, `stats`, giá, trần cường hóa). */
function bagItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    itemId: 'item-banh-bao',
    name: 'Bánh Bao Hấp',
    kind: 'consumable',
    quantity: 2,
    usable: true,
    description: '',
    slot: null,
    upgradeLevel: 0,
    stats: { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 },
    levelRequired: 1,
    price: 30,
    sellPrice: 12,
    upgradeMaxLevel: 0,
    ...overrides,
  };
}

/** Chỉ số tối thiểu của một nhân vật để thử các gói tin về chỉ số. */
const STATS: CharacterStats = {
  id: 'p1',
  name: 'Kakashi',
  school: 'haruna',
  class: 'dao',
  level: 1,
  exp: 0,
  expToNext: 30,
  yen: 200,
  hp: 60,
  maxHp: 60,
  mp: 40,
  maxMp: 40,
  strength: 6,
  agility: 5,
  spirit: 4,
  attack: 13,
  defense: 2,
  speed: 6,
  skills: [
    {
      skillId: 'skill-tram-co-ban',
      name: 'Trảm Cơ Bản',
      costMp: 5,
      cooldownTurns: 0,
      levelRequired: 1,
    },
  ],
};

describe('WorldState', () => {
  let world: WorldState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    world = TestBed.inject(WorldState);
  });

  it('bắt đầu ở trạng thái rỗng', () => {
    expect(world.map()).toBeNull();
    expect(world.entities()).toEqual([]);
    expect(world.self()).toBeNull();
    expect(world.chat()).toEqual([]);
    expect(world.npcDialog()).toBeNull();
    expect(world.tickRateMs()).toBe(TICK_RATE_MS);
  });

  it('áp S2C_ENTER_MAP: bản đồ, nhân vật của mình, thực thể xung quanh và chat cũ', () => {
    expect(world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap())).toBe(true);

    expect(world.map()?.id).toBe('lang-khoi-nguon');
    expect(world.mapName()).toBe('Làng Khởi Nguồn');
    expect(world.selfId()).toBe('p1');
    expect(world.self()?.name).toBe('Kakashi');
    expect(world.entities().map((each) => each.name)).toEqual(['Kakashi', 'Thầy Hiệu Trưởng']);
    expect(world.chat()).toEqual([
      { channel: 'map', fromName: 'Kakashi', text: 'xin chào', at: 10 },
    ]);
  });

  it('không thêm trùng nhân vật của mình khi server đã gửi kèm trong danh sách', () => {
    world.applyPacket(
      Opcode.S2C_ENTER_MAP,
      enterMap({ entities: [entity('p1', 'Kakashi'), entity('npc1', 'Thầy', { kind: 'npc' })] }),
    );

    expect(world.entities().map((each) => each.id)).toEqual(['p1', 'npc1']);
  });

  it('thêm, thay thế và xoá thực thể', () => {
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap());

    world.applyPacket(Opcode.S2C_ENTITY_ADD, { entity: entity('p2', 'Sasuke', { x: 40, y: 48 }) });
    expect(world.entities().map((each) => each.id)).toEqual(['p1', 'npc1', 'p2']);

    world.applyPacket(Opcode.S2C_ENTITY_ADD, { entity: entity('p2', 'Sasuke', { x: 80, y: 48 }) });
    expect(world.entities()).toHaveLength(3);
    expect(world.entities()[2].x).toBe(80);

    expect(world.applyPacket(Opcode.S2C_ENTITY_REMOVE, { id: 'npc1' })).toBe(true);
    expect(world.entities().map((each) => each.id)).toEqual(['p1', 'p2']);
  });

  it('cập nhật vị trí và hướng từ S2C_ENTITY_MOVE, bỏ qua thực thể lạ', () => {
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap());

    world.applyPacket(Opcode.S2C_ENTITY_MOVE, {
      moves: [
        { id: 'p1', x: 48, y: 32, facing: 'e' },
        { id: 'không-có-thật', x: 1, y: 1, facing: 'n' },
      ],
    });

    expect(world.self()?.x).toBe(48);
    expect(world.self()?.y).toBe(32);
    expect(world.self()?.facing).toBe('e');
    expect(world.entities()).toHaveLength(2);
  });

  it('giữ chat backlog và thêm tin mới vào cuối', () => {
    world.applyPacket(
      Opcode.S2C_ENTER_MAP,
      enterMap({
        chatBacklog: [
          { channel: 'map', fromName: 'Kakashi', text: 'tin 1', at: 1 },
          { channel: 'system', fromName: 'Hệ thống', text: 'tin 2', at: 2 },
        ],
      }),
    );

    world.applyPacket(Opcode.S2C_CHAT, {
      channel: 'map',
      fromId: 'p1',
      fromName: 'Kakashi',
      text: 'tin 3',
      at: 3,
    });

    expect(world.chat().map((line) => line.text)).toEqual(['tin 1', 'tin 2', 'tin 3']);
    expect(world.chat()[2].fromId).toBe('p1');
    expect(world.chat()[0].fromId).toBeUndefined();
  });

  it('không để khung chat phình vô hạn', () => {
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap({ chatBacklog: [] }));
    for (let index = 0; index < CHAT_LOG_LIMIT + 7; index += 1) {
      world.applyPacket(Opcode.S2C_CHAT, {
        channel: 'map',
        fromId: 'p1',
        fromName: 'Kakashi',
        text: `tin ${index}`,
        at: index,
      });
    }

    expect(world.chat()).toHaveLength(CHAT_LOG_LIMIT);
    expect(world.chat().at(-1)?.text).toBe(`tin ${CHAT_LOG_LIMIT + 6}`);
  });

  it('mở và đóng hội thoại NPC', () => {
    world.applyPacket(Opcode.S2C_NPC_DIALOG, {
      npcId: 'npc1',
      npcName: 'Thầy Hiệu Trưởng',
      lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Chào các em.' }],
    });
    expect(world.npcDialog()?.npcName).toBe('Thầy Hiệu Trưởng');

    world.closeDialog();
    expect(world.npcDialog()).toBeNull();
  });

  it('đổi map thì xoá hội thoại và chat cũ', () => {
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap());
    world.applyPacket(Opcode.S2C_NPC_DIALOG, {
      npcId: 'npc1',
      npcName: 'Thầy',
      lines: [{ speaker: 'Thầy', text: 'Chào.' }],
    });

    world.applyPacket(
      Opcode.S2C_ENTER_MAP,
      enterMap({
        map: { ...MAP, id: 'bai-luyen-tap', name: 'Bãi Luyện Tập' },
        chatBacklog: [],
      }),
    );

    expect(world.mapName()).toBe('Bãi Luyện Tập');
    expect(world.chat()).toEqual([]);
    expect(world.npcDialog()).toBeNull();
  });

  it('nhận chỉ số nhân vật và túi đồ, rồi cập nhật khi có thay đổi', () => {
    expect(world.character()).toBeNull();
    expect(world.inventory()).toEqual([]);
    expect(world.inventoryCapacity()).toBe(0);

    expect(world.applyPacket(Opcode.S2C_CHARACTER, STATS)).toBe(true);
    expect(world.character()?.level).toBe(1);
    expect(world.character()?.hp).toBe(60);

    expect(
      world.applyPacket(Opcode.S2C_INVENTORY_UPDATE, {
        items: [bagItem()],
        capacity: 40,
      } satisfies InventoryUpdate),
    ).toBe(true);
    expect(world.inventory().map((item) => item.quantity)).toEqual([2]);
    expect(world.inventoryCapacity()).toBe(40);

    expect(world.applyPacket(Opcode.S2C_INVENTORY_UPDATE, { items: [], capacity: 40 })).toBe(true);
    expect(world.inventory()).toEqual([]);
  });

  it('S2C_LEVEL_UP cập nhật chỉ số và ghi lại lần lên cấp để báo cho người chơi', () => {
    world.applyPacket(Opcode.S2C_CHARACTER, STATS);
    const levelUp: LevelUp = {
      character: { ...STATS, level: 4, exp: 8, expToNext: 209, maxHp: 102, hp: 102 },
      levelsGained: 3,
      learnedSkills: [{ skillId: 'skill-tram-cuong-phong', name: 'Trảm Cuồng Phong' }],
    };

    expect(world.applyPacket(Opcode.S2C_LEVEL_UP, levelUp)).toBe(true);
    expect(world.character()?.level).toBe(4);
    expect(world.lastLevelUp()?.levelsGained).toBe(3);
    expect(world.lastLevelUp()?.learnedSkills[0]?.name).toBe('Trảm Cuồng Phong');

    world.clearLevelUp();
    expect(world.lastLevelUp()).toBeNull();
  });

  it('quái trong S2C_ENTER_MAP mang theo máu, máu tối đa và hình dáng', () => {
    world.applyPacket(
      Opcode.S2C_ENTER_MAP,
      enterMap({
        entities: [
          entity('mob:lang-khoi-nguon:0', 'Bù Nhìn Tập Luyện', {
            kind: 'monster',
            x: 96,
            y: 64,
            hp: 30,
            maxHp: 30,
            shape: 'scarecrow',
          }),
        ],
      }),
    );

    const monster = world.entities().find((each) => each.kind === 'monster');
    expect(monster).toMatchObject({
      name: 'Bù Nhìn Tập Luyện',
      hp: 30,
      maxHp: 30,
      shape: 'scarecrow',
    });
  });

  it('server báo lại thực thể quái khi máu đổi thì client thay thế chứ không thêm mới', () => {
    const scarecrow = entity('mob:lang-khoi-nguon:0', 'Bù Nhìn Tập Luyện', {
      kind: 'monster',
      hp: 30,
      maxHp: 30,
      shape: 'scarecrow',
    });
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap({ entities: [scarecrow] }));

    world.applyPacket(Opcode.S2C_ENTITY_ADD, { entity: { ...scarecrow, hp: 0 } });

    const monsters = world.entities().filter((each) => each.kind === 'monster');
    expect(monsters).toHaveLength(1);
    expect(monsters[0]?.hp).toBe(0);
  });

  it('S2C_EQUIPMENT xếp lại thành đủ bốn ô theo thứ tự EQUIP_SLOTS', () => {
    // Chưa nhận gói nào thì giao diện vẫn phải vẽ đủ bốn ô trống.
    expect(world.equipment().map((entry) => entry.slot)).toEqual([...EQUIP_SLOTS]);
    expect(world.equipment().map((entry) => entry.item)).toEqual([null, null, null, null]);

    const sword = bagItem({
      itemId: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      kind: 'weapon',
      slot: 'weapon',
      quantity: 1,
      usable: false,
      upgradeLevel: 2,
      stats: { strength: 2, agility: 1, spirit: 0, hp: 8, mp: 0 },
      price: 80,
      sellPrice: 32,
      upgradeMaxLevel: 5,
    });

    // Hợp đồng không hứa thứ tự ô trong gói, nên gửi ô `head` trước vẫn phải ra đúng thứ tự bảng.
    expect(
      world.applyPacket(Opcode.S2C_EQUIPMENT, {
        slots: [
          { slot: 'head', item: null },
          { slot: 'weapon', item: sword },
        ],
      } satisfies EquipmentUpdate),
    ).toBe(true);

    const equipment = world.equipment();
    expect(equipment.map((entry) => entry.slot)).toEqual([...EQUIP_SLOTS]);
    expect(equipment[0]?.item?.name).toBe('Kiếm Gỗ');
    expect(equipment[0]?.item?.upgradeLevel).toBe(2);
    expect(equipment[0]?.item?.stats.strength).toBe(2);
    expect(equipment[1]?.item).toBeNull();
  });

  it('reset() xoá sạch thế giới khi mất kết nối', () => {
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap());
    world.reset();

    expect(world.map()).toBeNull();
    expect(world.entities()).toEqual([]);
    expect(world.self()).toBeNull();
    expect(world.chat()).toEqual([]);
    expect(world.character()).toBeNull();
    expect(world.inventory()).toEqual([]);
    expect(world.equipment().map((entry) => entry.item)).toEqual([null, null, null, null]);
    expect(world.lastLevelUp()).toBeNull();
  });

  it('bỏ qua gói không thuộc phần thế giới và nhận nhịp tick từ S2C_HELLO', () => {
    expect(world.applyPacket(Opcode.S2C_NOTIFY, { message: 'xin chào' })).toBe(false);
    expect(world.applyPacket(Opcode.S2C_PONG, { clientTime: 0, serverTime: 0 })).toBe(false);

    world.setTickRate(50);
    expect(world.tickRateMs()).toBe(50);
    world.setTickRate(0);
    expect(world.tickRateMs()).toBe(50);
  });
});

import { TestBed } from '@angular/core/testing';
import {
  Opcode,
  TICK_RATE_MS,
  type Entity,
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

  it('reset() xoá sạch thế giới khi mất kết nối', () => {
    world.applyPacket(Opcode.S2C_ENTER_MAP, enterMap());
    world.reset();

    expect(world.map()).toBeNull();
    expect(world.entities()).toEqual([]);
    expect(world.self()).toBeNull();
    expect(world.chat()).toEqual([]);
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

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  CHAT_MAX_LENGTH,
  ErrorCode,
  Opcode,
  PROTOCOL_VERSION,
  TICK_RATE_MS,
  encodePacket,
  upgradeSuccessRate,
  upgradeYenCost,
} from '@ninja/shared';
import { vi } from 'vitest';

// jsdom không có canvas 2D nên Phaser phải được thay bằng lớp giả; phần vẽ thật do e2e kiểm.
vi.mock('phaser', () => ({
  default: {
    AUTO: 'AUTO',
    Scale: { RESIZE: 'RESIZE', CENTER_BOTH: 'CENTER_BOTH' },
    Scene: class {},
    Game: class {
      destroy(): void {
        // không làm gì: Phaser giả
      }
    },
  },
}));

import { ACCESS_TOKEN_KEY } from '../../core/auth/auth.service';
import { WEBSOCKET_FACTORY } from '../../net/game-socket';
import { FakeWebSocket } from '../../net/testing/fake-websocket';
import { Play, SNAPSHOT_FALLBACK_DELAY } from './play';

const CREDENTIAL = 'access-token-test';
const FALLBACK_MS = 50;

const CHARACTER_A = {
  id: '22222221-2222-4222-8222-222222222222',
  name: 'Kakashi',
  school: 'haruna',
  class: 'dao',
  level: 1,
  exp: 0,
  yen: 1000,
  createdAt: '2026-10-15T10:00:00.000Z',
};

const CHARACTER_B = {
  ...CHARACTER_A,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Sasuke',
};

const MAP = {
  id: 'lang-khoi-nguon',
  name: 'Làng Khởi Nguồn',
  width: 4,
  height: 3,
  tileSize: 32,
  tiles: [{ id: 1, color: '#3b6b3f', blocked: false }],
  ground: [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ],
  decor: [
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
  ],
};

function helloFrame(): string {
  return encodePacket(
    Opcode.S2C_HELLO,
    {
      protocolVersion: PROTOCOL_VERSION,
      tickRateMs: TICK_RATE_MS,
      characterId: CHARACTER_A.id,
      characterName: 'Kakashi',
      mapId: 'lang-khoi-nguon',
      serverTime: 0,
    },
    1,
  );
}

function enterMapFrame(): string {
  return encodePacket(
    Opcode.S2C_ENTER_MAP,
    {
      map: MAP,
      entity: { id: 'p1', kind: 'player', name: 'Kakashi', color: '#ff8844', x: 32, y: 32 },
      entities: [
        { id: 'npc1', kind: 'npc', name: 'Thầy Hiệu Trưởng', color: '#dcdcdc', x: 96, y: 32 },
      ],
      chatBacklog: [{ channel: 'map', fromName: 'Kakashi', text: 'xin chào', at: 1 }],
    },
    2,
  );
}

/** Bản đồ có một con quái ngay cạnh nhân vật và một con ở xa, để thử cả hai nhánh bấm quái. */
function enterMapWithMonstersFrame(): string {
  return encodePacket(
    Opcode.S2C_ENTER_MAP,
    {
      map: MAP,
      entity: { id: 'p1', kind: 'player', name: 'Kakashi', color: '#ff8844', x: 32, y: 32 },
      entities: [
        {
          id: 'mob:lang-khoi-nguon:0',
          kind: 'monster',
          name: 'Bù Nhìn Tập Luyện',
          color: '#c8a165',
          x: 64,
          y: 32,
          level: 1,
          hp: 30,
          maxHp: 30,
          shape: 'scarecrow',
        },
        {
          id: 'mob:lang-khoi-nguon:1',
          kind: 'monster',
          name: 'Chuột Đồng',
          color: '#8d7f6a',
          // Cách nhân vật 128 px: ngoài tầm đánh (96 px) nhưng vẫn trong bản đồ 4×3 ô.
          x: 160,
          y: 32,
          level: 2,
          hp: 46,
          maxHp: 46,
          shape: 'rodent',
        },
      ],
      chatBacklog: [],
    },
    2,
  );
}

function characterFrame(overrides: Record<string, unknown> = {}): string {
  return encodePacket(
    Opcode.S2C_CHARACTER,
    {
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
      ...overrides,
    },
    3,
  );
}

function inventoryFrame(): string {
  return encodePacket(
    Opcode.S2C_INVENTORY_UPDATE,
    {
      items: [
        {
          itemId: 'item-banh-bao',
          name: 'Bánh Bao Hấp',
          kind: 'consumable',
          quantity: 2,
          usable: true,
          description: 'Hồi máu',
          healHp: 40,
          price: 30,
          sellPrice: 12,
        },
      ],
      capacity: 40,
    },
    4,
  );
}

/** Kiếm Gỗ +2 như server gửi: chỉ số đã tính cả cường hóa, giá và trần cường hóa đều có sẵn. */
const SWORD = {
  itemId: 'item-kiem-go',
  name: 'Kiếm Gỗ',
  kind: 'weapon',
  quantity: 1,
  usable: false,
  description: 'Vũ khí tập luyện',
  slot: 'weapon',
  upgradeLevel: 2,
  stats: { strength: 2, agility: 1, spirit: 0, hp: 8, mp: 0 },
  levelRequired: 1,
  price: 80,
  sellPrice: 32,
  upgradeMaxLevel: 5,
};

/** Túi có một món ăn (để bán) và một món mặc được kiêm cường hóa được. */
function gearInventoryFrame(seq: number): string {
  return encodePacket(
    Opcode.S2C_INVENTORY_UPDATE,
    {
      items: [
        {
          itemId: 'item-banh-bao',
          name: 'Bánh Bao Hấp',
          kind: 'consumable',
          quantity: 2,
          usable: true,
          description: 'Hồi máu',
          healHp: 40,
          price: 30,
          sellPrice: 12,
        },
        SWORD,
      ],
      capacity: 40,
    },
    seq,
  );
}

/** Trang bị đang mặc: chỉ ô vũ khí có món, để thấy cả ô đầy lẫn ô trống. */
function equipmentFrame(seq: number): string {
  return encodePacket(
    Opcode.S2C_EQUIPMENT,
    {
      slots: [
        { slot: 'weapon', item: SWORD },
        { slot: 'body', item: null },
        { slot: 'head', item: null },
        { slot: 'accessory', item: null },
      ],
    },
    seq,
  );
}

/** Hội thoại của NPC bán hàng: có `shop` nên trang phải mở bảng shop. */
function npcShopDialogFrame(seq: number): string {
  return encodePacket(
    Opcode.S2C_NPC_DIALOG,
    {
      npcId: 'npc1',
      npcName: 'Thầy Hiệu Trưởng',
      lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'Ta có đồ cho ngươi chọn.' }],
      shop: {
        sellRatio: 0.4,
        entries: [
          {
            itemId: SWORD.itemId,
            name: SWORD.name,
            kind: SWORD.kind,
            price: SWORD.price,
            sellPrice: SWORD.sellPrice,
            levelRequired: SWORD.levelRequired,
            description: SWORD.description,
            slot: SWORD.slot,
            stats: SWORD.stats,
            upgradeMaxLevel: SWORD.upgradeMaxLevel,
          },
        ],
      },
    },
    seq,
  );
}

/** Kết quả một lần cường hóa thất bại; server đã soạn sẵn câu tiếng Việt trong `message`. */
function upgradeResultFrame(seq: number): string {
  return encodePacket(
    Opcode.S2C_UPGRADE_RESULT,
    {
      itemId: SWORD.itemId,
      name: SWORD.name,
      success: false,
      upgradeLevel: 2,
      previousLevel: 2,
      successRate: 0.75,
      yenCost: 260,
      materialQty: 1,
      message: 'Cường hóa thất bại, Kiếm Gỗ giữ nguyên +2.',
    },
    seq,
  );
}

function battleStartFrame(overrides: Record<string, unknown> = {}): string {
  return encodePacket(
    Opcode.S2C_BATTLE_START,
    {
      battleId: 'btl:lang-khoi-nguon:mob:lang-khoi-nguon:0:1',
      roundNo: 1,
      participants: [
        {
          id: 'mob:lang-khoi-nguon:0',
          kind: 'monster',
          name: 'Bù Nhìn Tập Luyện',
          level: 1,
          hp: 30,
          maxHp: 30,
          mp: 0,
          maxMp: 0,
          attack: 4,
          defense: 1,
          speed: 3,
          alive: true,
        },
        {
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
          skills: [
            {
              skillId: 'skill-tram-co-ban',
              name: 'Trảm Cơ Bản',
              costMp: 5,
              cooldownTurns: 0,
              levelRequired: 1,
              readyInTurns: 0,
            },
          ],
        },
      ],
      actorId: 'p1',
      turnMs: 30000,
      turnEndsAt: Date.now() + 30000,
      ...overrides,
    },
    5,
  );
}

function noCharacterFrame(): string {
  return encodePacket(
    Opcode.S2C_ERROR,
    {
      code: ErrorCode.NO_CHARACTER,
      message: 'Tài khoản chưa có nhân vật nào.',
      fatal: true,
    },
    2,
  );
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Vẽ lại giao diện sau khi trạng thái đổi từ code (promise, sự kiện, gói tin). */
async function render(fixture: ComponentFixture<Play>): Promise<void> {
  await tick();
  fixture.detectChanges();
  await tick();
  fixture.detectChanges();
}

function element(fixture: ComponentFixture<Play>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function text(fixture: ComponentFixture<Play>): string {
  return element(fixture).textContent ?? '';
}

function overlay(fixture: ComponentFixture<Play>): Element | null {
  return element(fixture).querySelector('.connection-overlay');
}

function payloadOf(packet: { payload: unknown }): Record<string, unknown> {
  return packet.payload as Record<string, unknown>;
}

/** Mở kết nối giả, bắt tay và (mặc định) gửi luôn dữ liệu map. */
async function joinWorld(
  fixture: ComponentFixture<Play>,
  options: { map?: boolean } = {},
): Promise<FakeWebSocket> {
  const webSocket = FakeWebSocket.last;
  webSocket.open();
  webSocket.deliver(helloFrame());
  if (options.map !== false) {
    webSocket.deliver(enterMapFrame());
  }
  await render(fixture);
  return webSocket;
}

describe('Play', () => {
  let fixture: ComponentFixture<Play> | undefined;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN_KEY, CREDENTIAL);
    FakeWebSocket.reset();
    delete window.__ninjaWorld;
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    localStorage.clear();
  });

  async function setup(
    options: { characters?: unknown[]; characterId?: string } = {},
  ): Promise<ComponentFixture<Play>> {
    await TestBed.configureTestingModule({
      imports: [Play],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WEBSOCKET_FACTORY, useValue: FakeWebSocket.factory() },
        { provide: SNAPSHOT_FALLBACK_DELAY, useValue: FALLBACK_MS },
      ],
    }).compileComponents();

    const created = TestBed.createComponent(Play);
    if (options.characterId) {
      created.componentRef.setInput('characterId', options.characterId);
    }
    created.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/characters')
      .flush({ characters: options.characters ?? [CHARACTER_A] });
    await render(created);
    return created;
  }

  it('mời sang trang nhân vật khi tài khoản chưa có nhân vật', async () => {
    fixture = await setup({ characters: [] });

    expect(text(fixture)).toContain('chưa có nhân vật');
    expect(element(fixture).querySelector('a[href="/characters"]')).not.toBeNull();
    // Chưa có nhân vật thì không mở kết nối làm gì.
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('mở kết nối bằng nhân vật đầu tiên và gửi characterId trong C2S_HELLO', async () => {
    fixture = await setup({ characters: [CHARACTER_A, CHARACTER_B], characterId: CHARACTER_B.id });

    const webSocket = FakeWebSocket.last;
    webSocket.open();
    const hello = payloadOf(webSocket.packets()[0]);
    expect(webSocket.packets()[0].op).toBe(Opcode.C2S_HELLO);
    expect(hello['characterId']).toBe(CHARACTER_B.id);
    expect(hello['clientVersion']).toBe('web-0.1.0');
  });

  it('bấm vào quái đủ gần thì xin vào trận ngay', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    await render(fixture);

    window.__ninjaWorld?.attackMonster('Bù Nhìn Tập Luyện');
    await render(fixture);

    const attack = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_ATTACK_MOB)
      .at(-1);
    expect(payloadOf(attack!)).toEqual({ targetId: 'mob:lang-khoi-nguon:0' });
    expect(webSocket.packets().some((packet) => packet.op === Opcode.C2S_MOVE)).toBe(false);
  });

  it('bấm vào quái ở xa thì đi tới trước, tới đủ tầm thì tự xin vào trận', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    await render(fixture);

    window.__ninjaWorld?.attackMonster('Chuột Đồng');
    // Lệnh di chuyển đi theo nhịp 10 lệnh/giây nên phải chờ một nhịp.
    await sleep(140);
    await render(fixture);

    const move = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_MOVE)
      .at(-1);
    expect(payloadOf(move!)['y']).toBe(32);
    expect(webSocket.packets().some((packet) => packet.op === Opcode.C2S_ATTACK_MOB)).toBe(false);

    // Server báo con chuột đã tới sát nhân vật: client tự xin vào trận, không cần bấm lại.
    webSocket.deliver(
      encodePacket(
        Opcode.S2C_ENTITY_MOVE,
        { moves: [{ id: 'mob:lang-khoi-nguon:1', x: 64, y: 32, facing: 'none' }] },
        6,
      ),
    );
    await sleep(140);
    await render(fixture);
    const attack = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_ATTACK_MOB)
      .at(-1);
    expect(payloadOf(attack!)).toEqual({ targetId: 'mob:lang-khoi-nguon:1' });
  });

  it('bấm vào quái xa hơn một lệnh di chuyển thì đi từng chặng, không đứng im', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    await render(fixture);
    // Đẩy con chuột ra xa 668 px — hơn giới hạn một lệnh `C2S_MOVE` (600 px).
    webSocket.deliver(
      encodePacket(
        Opcode.S2C_ENTITY_MOVE,
        { moves: [{ id: 'mob:lang-khoi-nguon:1', x: 700, y: 32, facing: 'none' }] },
        6,
      ),
    );
    await render(fixture);

    window.__ninjaWorld?.attackMonster('Chuột Đồng');
    await sleep(140);
    await render(fixture);

    // Chặng đầu dừng đúng ở giới hạn 600 px, vẫn nằm trên đường tới con quái.
    const firstLeg = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_MOVE)
      .at(-1);
    expect(payloadOf(firstLeg!)).toEqual({ x: 632, y: 32 });
    expect(webSocket.packets().some((packet) => packet.op === Opcode.C2S_ATTACK_MOB)).toBe(false);

    // Nhân vật nhích được một quãng: client gửi chặng mới, lần này nhắm thẳng con quái.
    webSocket.deliver(
      encodePacket(
        Opcode.S2C_ENTITY_MOVE,
        { moves: [{ id: 'p1', x: 100, y: 32, facing: 'e' }] },
        7,
      ),
    );
    await sleep(140);
    await render(fixture);
    const secondLeg = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_MOVE)
      .at(-1);
    expect(payloadOf(secondLeg!)).toEqual({ x: 700, y: 32 });

    // Tới đủ tầm thì tự xin vào trận, không cần bấm lại.
    webSocket.deliver(
      encodePacket(
        Opcode.S2C_ENTITY_MOVE,
        { moves: [{ id: 'p1', x: 650, y: 32, facing: 'e' }] },
        8,
      ),
    );
    await sleep(140);
    await render(fixture);
    const attack = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_ATTACK_MOB)
      .at(-1);
    expect(payloadOf(attack!)).toEqual({ targetId: 'mob:lang-khoi-nguon:1' });
  });

  it('bảng trận đấu hiện ra khi server mở trận và nút Đánh thường gửi hành động', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(characterFrame());
    webSocket.deliver(battleStartFrame());
    await render(fixture);

    expect(text(fixture)).toContain('Bù Nhìn Tập Luyện');
    expect(text(fixture)).toContain('Tới lượt bạn');
    expect(text(fixture)).toContain('Đánh thường');

    const attackButton = [...element(fixture).querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Đánh thường'),
    );
    attackButton?.click();
    await render(fixture);

    const action = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_BATTLE_ACTION)
      .at(-1);
    expect(payloadOf(action!)).toMatchObject({
      battleId: 'btl:lang-khoi-nguon:mob:lang-khoi-nguon:0:1',
      action: 'attack',
      targetId: 'mob:lang-khoi-nguon:0',
    });
  });

  it('túi đồ mở được và nút Dùng gửi C2S_USE_ITEM', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(characterFrame());
    webSocket.deliver(inventoryFrame());
    await render(fixture);

    expect(window.__ninjaWorld?.inventory()).toEqual([
      {
        itemId: 'item-banh-bao',
        name: 'Bánh Bao Hấp',
        quantity: 2,
        usable: true,
        slot: null,
        upgradeLevel: 0,
        sellPrice: 12,
      },
    ]);

    window.__ninjaWorld?.toggleInventory(true);
    await render(fixture);
    expect(text(fixture)).toContain('Bánh Bao Hấp');
    expect(window.__ninjaWorld?.inventoryOpen()).toBe(true);

    const useButton = [...element(fixture).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Dùng',
    );
    useButton?.click();
    await render(fixture);

    const use = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_USE_ITEM)
      .at(-1);
    expect(payloadOf(use!)).toEqual({ itemId: 'item-banh-bao' });
  });

  it('mở bảng trang bị từ HUD: thấy món đang mặc và nút Tháo gửi C2S_UNEQUIP', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(equipmentFrame(7));
    await render(fixture);

    const gearButton = element(fixture).querySelector('.hud__gear');
    expect(gearButton).not.toBeNull();
    (gearButton as HTMLElement).click();
    await render(fixture);

    expect(window.__ninjaWorld?.equipmentOpen()).toBe(true);
    const rows = [...element(fixture).querySelectorAll('.gear__row')];
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('Vũ khí');
    expect(rows[0]?.textContent).toContain('Kiếm Gỗ');
    expect(rows[0]?.textContent).toContain('+2');
    expect(rows[0]?.textContent).toContain('Sức mạnh +2');
    // Ba ô còn lại chưa có món nào: hiện tên ô và chữ "Trống", không có nút Tháo.
    expect(rows[1]?.textContent).toContain('Áo');
    expect(rows[1]?.textContent).toContain('Trống');
    expect(rows[1]?.querySelector('.gear__unequip')).toBeNull();

    (rows[0]?.querySelector('.gear__unequip') as HTMLElement).click();
    await render(fixture);

    const unequip = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_UNEQUIP)
      .at(-1);
    expect(payloadOf(unequip!)).toEqual({ slot: 'weapon' });
    // Tháo xong bảng vẫn mở để còn tháo món khác.
    expect(window.__ninjaWorld?.equipmentOpen()).toBe(true);

    (element(fixture).querySelector('.gear__close') as HTMLElement).click();
    await render(fixture);
    expect(window.__ninjaWorld?.equipmentOpen()).toBe(false);
    expect(element(fixture).querySelector('.gear')).toBeNull();
  });

  it('nút Mặc và nút Cường hóa trong túi gửi gói tin, kết quả hiện lên thanh thông báo', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(gearInventoryFrame(8));
    await render(fixture);

    window.__ninjaWorld?.toggleInventory(true);
    await render(fixture);

    const row = [...element(fixture).querySelectorAll('.bag__row')].find((candidate) =>
      candidate.textContent?.includes('Kiếm Gỗ'),
    );
    expect(row?.querySelector('.bag__level')?.textContent?.trim()).toBe('+2');
    expect(row?.querySelector('.bag__stats')?.textContent).toContain('Sức mạnh +2');
    // Số yên và tỉ lệ phải là của cấp hiện tại (2), không phải của cấp 0.
    const upgradeLabel = row?.querySelector('.bag__upgrade')?.textContent ?? '';
    expect(upgradeLabel).toContain('Cường hóa');
    expect(upgradeLabel).toContain(`${upgradeYenCost(2)} yên`);
    expect(upgradeLabel).toContain(`${Math.round(upgradeSuccessRate(2) * 100)}%`);
    // Món ăn không mặc được và không cường hóa được: chỉ có nút Dùng.
    const foodRow = [...element(fixture).querySelectorAll('.bag__row')].find((candidate) =>
      candidate.textContent?.includes('Bánh Bao Hấp'),
    );
    expect(foodRow?.querySelector('.bag__equip')).toBeNull();
    expect(foodRow?.querySelector('.bag__upgrade')).toBeNull();

    (row?.querySelector('.bag__equip') as HTMLElement).click();
    (row?.querySelector('.bag__upgrade') as HTMLElement).click();
    await render(fixture);

    const equip = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_EQUIP)
      .at(-1);
    expect(payloadOf(equip!)).toEqual({ itemId: 'item-kiem-go' });
    const upgrade = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_UPGRADE)
      .at(-1);
    expect(payloadOf(upgrade!)).toEqual({ itemId: 'item-kiem-go' });

    webSocket.deliver(upgradeResultFrame(9));
    await render(fixture);

    // Câu của server hiện nguyên văn trên thanh thông báo, kèm tỉ lệ của chính lần thử đó.
    const notice = element(fixture).querySelector('.notice-bar')?.textContent ?? '';
    expect(notice).toContain('Cường hóa thất bại, Kiếm Gỗ giữ nguyên +2.');
    expect(notice).toContain('(tỉ lệ 75%)');
  });

  it('bảng shop hiện khi NPC có hàng: Mua/Bán gửi gói tin, bấm xong bảng vẫn mở', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(gearInventoryFrame(8));
    webSocket.deliver(npcShopDialogFrame(10));
    await render(fixture);

    expect(window.__ninjaWorld?.shop()?.npcName).toBe('Thầy Hiệu Trưởng');
    expect(window.__ninjaWorld?.shop()?.entries).toEqual([
      { name: 'Kiếm Gỗ', price: 80, sellPrice: 32 },
    ]);

    const rows = [...element(fixture).querySelectorAll('.shop__row')];
    const buyRow = rows.find((row) => row.querySelector('.shop__buy') !== null);
    expect(buyRow?.textContent).toContain('Kiếm Gỗ');
    expect(buyRow?.textContent).toContain('80 yên');
    (buyRow?.querySelector('.shop__buy') as HTMLElement).click();

    // Bảng "Bán" lấy thẳng túi đồ: có cả món ăn lẫn kiếm, không lọc theo hàng của shop.
    const sellRows = rows.filter((row) => row.querySelector('.shop__sell') !== null);
    expect(sellRows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Bánh Bao Hấp')]),
    );
    const foodRow = sellRows.find((row) => row.textContent?.includes('Bánh Bao Hấp'));
    expect(foodRow?.textContent).toContain('12 yên');
    (foodRow?.querySelector('.shop__sell') as HTMLElement).click();
    await render(fixture);

    const buy = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_SHOP_BUY)
      .at(-1);
    expect(payloadOf(buy!)).toEqual({ itemId: 'item-kiem-go', quantity: 1 });
    const sell = webSocket
      .packets()
      .filter((packet) => packet.op === Opcode.C2S_SHOP_SELL)
      .at(-1);
    expect(payloadOf(sell!)).toEqual({ itemId: 'item-banh-bao', quantity: 1 });

    // Mua/bán xong quầy vẫn mở để người chơi bấm tiếp.
    expect(element(fixture).querySelector('.shop')).not.toBeNull();
    expect(window.__ninjaWorld?.shop()).not.toBeNull();

    (element(fixture).querySelector('.shop__close') as HTMLElement).click();
    await render(fixture);
    expect(element(fixture).querySelector('.shop')).toBeNull();
    expect(window.__ninjaWorld?.shop()).toBeNull();
  });

  it('hook kiểm thử phơi trạng thái M4 cho e2e', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(equipmentFrame(7));
    webSocket.deliver(gearInventoryFrame(8));
    webSocket.deliver(npcShopDialogFrame(10));
    await render(fixture);

    const hook = window.__ninjaWorld;
    expect(
      hook?.inventory().map((item) => ({
        itemId: item.itemId,
        slot: item.slot,
        upgradeLevel: item.upgradeLevel,
        sellPrice: item.sellPrice,
      })),
    ).toEqual([
      { itemId: 'item-banh-bao', slot: null, upgradeLevel: 0, sellPrice: 12 },
      { itemId: 'item-kiem-go', slot: 'weapon', upgradeLevel: 2, sellPrice: 32 },
    ]);

    // Bốn ô theo thứ tự EQUIP_SLOTS, ô trống vừa có `empty` vừa có tên rỗng.
    expect(hook?.equipment().map((entry) => entry.slot)).toEqual([
      'weapon',
      'body',
      'head',
      'accessory',
    ]);
    expect(hook?.equipment().map((entry) => entry.empty)).toEqual([false, true, true, true]);
    expect(hook?.equipment()[0]).toMatchObject({
      name: 'Kiếm Gỗ',
      upgradeLevel: 2,
      stats: { strength: 2, agility: 1, spirit: 0, hp: 8, mp: 0 },
    });
    expect(hook?.equipment()[1]?.name).toBe('');
    expect(hook?.shop()?.entries[0]?.price).toBe(80);

    hook?.toggleEquipment(true);
    await render(fixture);
    expect(hook?.equipmentOpen()).toBe(true);
    expect(element(fixture).querySelector('.gear')).not.toBeNull();

    hook?.toggleEquipment(false);
    await render(fixture);
    expect(hook?.equipmentOpen()).toBe(false);
    expect(element(fixture).querySelector('.gear')).toBeNull();
  });

  it('hook kiểm thử phơi chỉ số nhân vật để e2e thấy mặc đồ là chỉ số tăng', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(characterFrame());
    await render(fixture);

    expect(window.__ninjaWorld?.character()).toMatchObject({
      strength: 6,
      agility: 5,
      spirit: 4,
      attack: 13,
      defense: 2,
      speed: 6,
      maxHp: 60,
    });

    // Server gửi lại `S2C_CHARACTER` sau khi mặc đồ; hook phải đọc được ngay con số mới.
    webSocket.deliver(characterFrame({ strength: 8, maxHp: 68, hp: 68 }));
    await render(fixture);

    expect(window.__ninjaWorld?.character()).toMatchObject({ strength: 8, maxHp: 68, hp: 68 });
  });

  it('trong trận thì bấm chỗ khác không gửi lệnh di chuyển', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });
    webSocket.deliver(enterMapWithMonstersFrame());
    webSocket.deliver(battleStartFrame());
    await render(fixture);

    const before = webSocket.packets().filter((packet) => packet.op === Opcode.C2S_MOVE).length;
    window.__ninjaWorld?.clickEntity('Kakashi');
    await render(fixture);

    expect(webSocket.packets().filter((packet) => packet.op === Opcode.C2S_MOVE)).toHaveLength(
      before,
    );
  });

  it('hiện lớp phủ đang kết nối lại khi mất kết nối', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture);

    expect(overlay(fixture)).toBeNull();

    webSocket.fail();
    await render(fixture);

    expect(overlay(fixture)).not.toBeNull();
    expect(overlay(fixture)?.textContent).toContain('Đang kết nối lại');
  });

  it('bắt tay lại thì bỏ bản đồ cũ rồi nạp bản đồ mới', async () => {
    fixture = await setup();
    const first = await joinWorld(fixture);
    expect(window.__ninjaWorld?.entityNames()).toEqual(['Kakashi', 'Thầy Hiệu Trưởng']);

    first.fail();
    await render(fixture);
    expect(window.__ninjaWorld?.entityNames()).toEqual([]);

    // Socket hẹn nối lại sau 1 giây; đây là thời gian thật nên phải chờ.
    await sleep(1100);
    const second = FakeWebSocket.last;
    expect(second).not.toBe(first);

    second.open();
    second.deliver(helloFrame());
    second.deliver(enterMapFrame());
    await render(fixture);

    expect(window.__ninjaWorld?.entityNames()).toEqual(['Kakashi', 'Thầy Hiệu Trưởng']);
    expect(overlay(fixture)).toBeNull();
  });

  it('hiện hướng dẫn khi server báo no_character', async () => {
    fixture = await setup();
    const webSocket = FakeWebSocket.last;
    webSocket.open();
    webSocket.deliver(noCharacterFrame());
    await render(fixture);

    expect(text(fixture)).toContain('chưa có nhân vật');
    expect(element(fixture).querySelector('a[href="/characters"]')).not.toBeNull();
    // Lỗi không thể tự khỏi thì không hiện lớp phủ nối lại nữa.
    expect(overlay(fixture)).toBeNull();
  });

  it('xin lại dữ liệu map khi server im lặng sau bắt tay', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture, { map: false });

    expect(webSocket.ops()).not.toContain(Opcode.C2S_ENTER_MAP);

    await sleep(FALLBACK_MS + 40);
    const last = webSocket.lastPacket();
    expect(last.op).toBe(Opcode.C2S_ENTER_MAP);
    expect(payloadOf(last)['mapId']).toBe('lang-khoi-nguon');
  });

  it('không xin lại map khi server đã gửi dữ liệu map', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture);

    await sleep(FALLBACK_MS + 40);
    expect(webSocket.ops()).not.toContain(Opcode.C2S_ENTER_MAP);
  });

  it('hiện nhật ký chat và gửi tin qua kênh map', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture);

    const log = element(fixture).querySelector('.chat-log');
    expect(log?.textContent).toContain('xin chào');

    const input = element(fixture).querySelector<HTMLInputElement>('.chat-input');
    expect(input?.placeholder).toBe('Nhập tin nhắn…');
    expect(input?.getAttribute('maxlength')).toBe(String(CHAT_MAX_LENGTH));

    if (!input) {
      throw new Error('không tìm thấy ô nhập chat');
    }
    input.value = 'chào cả làng';
    input.dispatchEvent(new Event('input'));
    await render(fixture);

    element(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
    await render(fixture);

    const sent = webSocket.lastPacket();
    expect(sent.op).toBe(Opcode.C2S_CHAT);
    expect(payloadOf(sent)).toMatchObject({ channel: 'map', text: 'chào cả làng' });
  });

  it('phơi hook kiểm thử ở chế độ phát triển và gỡ khi rời trang', async () => {
    fixture = await setup();
    const webSocket = await joinWorld(fixture);

    const hook = window.__ninjaWorld;
    expect(hook).toBeDefined();
    expect(hook?.localPlayerName()).toBe('Kakashi');
    expect(hook?.entityNames()).toEqual(['Kakashi', 'Thầy Hiệu Trưởng']);
    expect(hook?.npcNames()).toEqual(['Thầy Hiệu Trưởng']);
    expect(hook?.position('Thầy Hiệu Trưởng')).toEqual({ x: 96, y: 32 });
    expect(hook?.position('không có ai tên này')).toBeNull();

    hook?.clickEntity('Thầy Hiệu Trưởng');
    const talk = webSocket.lastPacket();
    expect(talk.op).toBe(Opcode.C2S_NPC_TALK);
    expect(payloadOf(talk)['npcId']).toBe('npc1');

    fixture.destroy();
    fixture = undefined;
    expect(window.__ninjaWorld).toBeUndefined();
  });

  it('hook bấm vào người chơi khác thì đi tới chỗ người đó', async () => {
    fixture = await setup();
    const webSocket = FakeWebSocket.last;
    webSocket.open();
    webSocket.deliver(helloFrame());
    webSocket.deliver(
      encodePacket(
        Opcode.S2C_ENTER_MAP,
        {
          map: MAP,
          entity: { id: 'p1', kind: 'player', name: 'Kakashi', color: '#ff8844', x: 32, y: 32 },
          entities: [{ id: 'p2', kind: 'player', name: 'Sasuke', color: '#2255aa', x: 160, y: 64 }],
          chatBacklog: [],
        },
        2,
      ),
    );
    await render(fixture);

    window.__ninjaWorld?.clickEntity('Sasuke');
    // Lệnh di chuyển đi theo nhịp 10 lệnh/giây nên phải chờ một nhịp.
    await sleep(140);

    const sent = webSocket.lastPacket();
    expect(sent.op).toBe(Opcode.C2S_MOVE);
    expect(payloadOf(sent)).toEqual({ x: 160, y: 64 });
  });
});

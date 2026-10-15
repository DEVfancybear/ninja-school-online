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
          entities: [
            { id: 'p2', kind: 'player', name: 'Sasuke', color: '#2255aa', x: 160, y: 64 },
          ],
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

import { TestBed } from '@angular/core/testing';
import { ErrorCode, Opcode, PROTOCOL_VERSION, TICK_RATE_MS, encodePacket } from '@ninja/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_VERSION,
  CLOCK,
  GameSocket,
  MAX_QUEUED_PACKETS,
  RECONNECT_DELAYS_MS,
  WEBSOCKET_FACTORY,
  reconnectDelay,
} from './game-socket';
import { FakeWebSocket, type SentPacket } from './testing/fake-websocket';

const CREDENTIAL = 'access-token-test';
const CHARACTER_ID = '22222222-2222-4222-8222-222222222222';

function helloFrame(): string {
  return encodePacket(
    Opcode.S2C_HELLO,
    {
      protocolVersion: PROTOCOL_VERSION,
      tickRateMs: TICK_RATE_MS,
      characterId: CHARACTER_ID,
      characterName: 'Kakashi',
      mapId: 'lang-khoi-nguon',
      serverTime: 0,
    },
    1,
  );
}

function errorFrame(code: string, message: string, fatal = false): string {
  return encodePacket(Opcode.S2C_ERROR, { code, message, fatal }, 1);
}

function payloadOf(packet: SentPacket): Record<string, unknown> {
  return packet.payload as Record<string, unknown>;
}

describe('GameSocket', () => {
  let socket: GameSocket;
  let clock: number;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    FakeWebSocket.reset();
    clock = 1000;
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: WEBSOCKET_FACTORY, useValue: FakeWebSocket.factory() },
        { provide: CLOCK, useValue: () => clock },
      ],
    });
    socket = TestBed.inject(GameSocket);
  });

  afterEach(() => {
    socket.disconnect();
    warn.mockRestore();
    vi.useRealTimers();
  });

  describe('bắt tay', () => {
    it('nối tới /ws cùng origin và gửi C2S_HELLO trước mọi gói khác', () => {
      socket.connect({ credential: CREDENTIAL, characterId: CHARACTER_ID });
      expect(socket.status()).toBe('connecting');

      const webSocket = FakeWebSocket.last;
      expect(webSocket.url).toBe(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
      );

      webSocket.open();
      expect(socket.status()).toBe('handshaking');

      const packets = webSocket.packets();
      expect(packets).toHaveLength(1);
      expect(packets[0].op).toBe(Opcode.C2S_HELLO);
      expect(payloadOf(packets[0])['token']).toBe(CREDENTIAL);
      expect(payloadOf(packets[0])).toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
        clientVersion: CLIENT_VERSION,
        characterId: CHARACTER_ID,
      });
    });

    it('chuyển sang ready, ghi nhớ S2C_HELLO và tăng connectionEpoch', () => {
      socket.connect({ credential: CREDENTIAL });
      FakeWebSocket.last.open();
      FakeWebSocket.last.deliver(helloFrame());

      expect(socket.status()).toBe('ready');
      expect(socket.isReady()).toBe(true);
      expect(socket.serverHello()?.mapId).toBe('lang-khoi-nguon');
      expect(socket.connectionEpoch()).toBe(1);
    });

    it('xếp hàng gói gửi trước khi bắt tay xong rồi gửi lại theo đúng thứ tự', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;

      socket.send(Opcode.C2S_CHAT, { channel: 'map', text: 'xin chào' });
      socket.send(Opcode.C2S_MOVE, { x: 32, y: 64 });
      webSocket.open();

      // Chưa có S2C_HELLO thì chỉ HELLO được gửi đi.
      expect(webSocket.ops()).toEqual([Opcode.C2S_HELLO]);

      webSocket.deliver(helloFrame());
      expect(webSocket.ops()).toEqual([
        Opcode.C2S_HELLO,
        Opcode.C2S_CHAT,
        Opcode.C2S_MOVE,
        Opcode.C2S_PING,
      ]);
    });

    it('giữ ý định mới nhất khi hàng đợi đầy', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      for (let index = 0; index < MAX_QUEUED_PACKETS + 5; index += 1) {
        socket.send(Opcode.C2S_CHAT, { channel: 'map', text: `tin ${index}` });
      }
      webSocket.open();
      webSocket.deliver(helloFrame());

      const chats = webSocket
        .packets()
        .filter((packet) => packet.op === Opcode.C2S_CHAT)
        .map((packet) => payloadOf(packet)['text']);
      expect(chats).toHaveLength(MAX_QUEUED_PACKETS);
      expect(chats[0]).toBe('tin 5');
      expect(chats.at(-1)).toBe(`tin ${MAX_QUEUED_PACKETS + 4}`);
    });

    it('không gửi gói nào khi chưa từng gọi connect', () => {
      expect(socket.send(Opcode.C2S_PING, { clientTime: 0 })).toBe(false);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('gửi ngay khi đã sẵn sàng', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(helloFrame());
      socket.send(Opcode.C2S_NPC_TALK, { npcId: 'npc-1' });

      expect(webSocket.lastPacket().op).toBe(Opcode.C2S_NPC_TALK);
    });
  });

  describe('nhịp tim', () => {
    it('gửi C2S_PING ngay sau bắt tay và lặp lại theo HEARTBEAT_INTERVAL_MS', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(helloFrame());

      expect(webSocket.ops().filter((op) => op === Opcode.C2S_PING)).toHaveLength(1);

      clock += 5000;
      vi.advanceTimersByTime(5000);
      expect(webSocket.ops().filter((op) => op === Opcode.C2S_PING)).toHaveLength(2);
    });

    it('đo độ trễ từ S2C_PONG theo clientTime gửi đi', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(helloFrame());
      expect(socket.latencyMs()).toBeNull();

      const ping = webSocket.packets().find((packet) => packet.op === Opcode.C2S_PING);
      const clientTime = payloadOf(ping as SentPacket)['clientTime'] as number;
      clock = clientTime + 42;
      webSocket.deliver(encodePacket(Opcode.S2C_PONG, { clientTime, serverTime: 7 }, 2));

      expect(socket.latencyMs()).toBe(42);
    });
  });

  describe('lỗi từ server', () => {
    it('giữ thông báo tiếng Việt của S2C_ERROR nhưng vẫn chơi tiếp khi lỗi tạm thời', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(helloFrame());

      webSocket.deliver(errorFrame(ErrorCode.RATE_LIMITED, 'Bạn gửi tin nhắn quá nhanh'));

      expect(socket.error()).toEqual({
        code: ErrorCode.RATE_LIMITED,
        message: 'Bạn gửi tin nhắn quá nhanh',
        fatal: false,
      });
      expect(socket.status()).toBe('ready');
    });

    it('dừng hẳn khi lỗi không thể tự khỏi (no_character)', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(errorFrame(ErrorCode.NO_CHARACTER, 'Tài khoản chưa có nhân vật', true));

      expect(socket.error()?.fatal).toBe(true);
      expect(socket.status()).toBe('error');

      // Server đóng kết nối sau lỗi nghiêm trọng: không được thử lại.
      webSocket.fail();
      vi.advanceTimersByTime(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(socket.status()).toBe('error');
    });
  });

  describe('nối lại', () => {
    it('lùi dần 1s, 2s, 4s và giữ mức trần 15s', () => {
      expect(RECONNECT_DELAYS_MS[0]).toBe(1000);
      expect(RECONNECT_DELAYS_MS.at(-1)).toBe(15000);
      expect([0, 1, 2, 3, 4, 9].map(reconnectDelay)).toEqual([
        1000, 2000, 4000, 8000, 15000, 15000,
      ]);
    });

    it('nối lại sau khi mất kết nối và bắt tay lại từ đầu', () => {
      socket.connect({ credential: CREDENTIAL, characterId: CHARACTER_ID });
      const first = FakeWebSocket.last;
      first.open();
      first.deliver(helloFrame());
      expect(socket.connectionEpoch()).toBe(1);

      first.fail();
      expect(socket.status()).toBe('closed');

      vi.advanceTimersByTime(999);
      expect(FakeWebSocket.instances).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(2);

      const second = FakeWebSocket.last;
      second.open();
      expect(second.ops()).toEqual([Opcode.C2S_HELLO]);
      second.deliver(helloFrame());
      expect(socket.status()).toBe('ready');
      expect(socket.connectionEpoch()).toBe(2);
    });

    it('tăng dần thời gian chờ sau mỗi lần thất bại', () => {
      socket.connect({ credential: CREDENTIAL });
      FakeWebSocket.last.fail();
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(2);

      FakeWebSocket.last.fail();
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(3);

      FakeWebSocket.last.fail();
      vi.advanceTimersByTime(4000);
      expect(FakeWebSocket.instances).toHaveLength(4);
    });

    it('không nối lại sau disconnect()', () => {
      socket.connect({ credential: CREDENTIAL });
      FakeWebSocket.last.fail();
      socket.disconnect();

      vi.advanceTimersByTime(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(socket.status()).toBe('closed');
    });
  });

  describe('gói tin nhận được', () => {
    it('bỏ qua khung tin sai và gói sai mà không ném ra ngoài', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(helloFrame());

      const listener = vi.fn();
      socket.onPacket(listener);

      webSocket.deliver('không phải JSON');
      webSocket.deliver(encodePacket(0x9999, {}, 1));
      webSocket.deliver(encodePacket(Opcode.S2C_CHAT, { channel: 'map' }, 1));

      expect(warn).toHaveBeenCalledTimes(3);
      expect(listener).not.toHaveBeenCalled();

      webSocket.deliver(
        encodePacket(
          Opcode.S2C_CHAT,
          { channel: 'map', fromId: 'p1', fromName: 'Kakashi', text: 'chào', at: 1 },
          2,
        ),
      );
      expect(listener).toHaveBeenCalledWith(Opcode.S2C_CHAT, expect.anything());
    });

    it('người nghe lỗi không làm sập phiên chơi', () => {
      const broken = vi.fn(() => {
        throw new Error('người nghe hỏng');
      });
      const healthy = vi.fn();
      socket.onPacket(broken);
      socket.onPacket(healthy);
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(
        encodePacket(Opcode.S2C_NOTIFY, { message: 'Chào mừng tới Làng Khởi Nguồn' }, 2),
      );

      expect(healthy).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    });

    it('gỡ được người nghe', () => {
      socket.connect({ credential: CREDENTIAL });
      const webSocket = FakeWebSocket.last;
      webSocket.open();
      webSocket.deliver(helloFrame());

      const listener = vi.fn();
      const unsubscribe = socket.onPacket(listener);
      webSocket.deliver(encodePacket(Opcode.S2C_NOTIFY, { message: 'xin chào' }, 3));
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      webSocket.deliver(encodePacket(Opcode.S2C_NOTIFY, { message: 'tạm biệt' }, 4));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

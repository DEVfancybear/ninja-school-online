import { decodeEnvelope } from '@ninja/shared';
import type { WebSocketFactory, WebSocketLike } from '../game-socket';

/** Một gói client đã gửi, đã giải mã để khẳng định cho dễ đọc. */
export interface SentPacket {
  readonly op: number;
  readonly seq: number;
  readonly payload: unknown;
}

/**
 * WebSocket giả: không có mạng, không có thời gian thật.
 *
 * Kiểm thử điều khiển được từng bước của vòng đời (`open`, `deliver`, `fail`, `close`) và đọc
 * lại mọi khung tin client đã gửi, nên khẳng định được cả **thứ tự** gói tin.
 */
export class FakeWebSocket implements WebSocketLike {
  static readonly instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances.length = 0;
  }

  static get last(): FakeWebSocket {
    const instance = FakeWebSocket.instances.at(-1);
    if (!instance) {
      throw new Error('chưa có WebSocket nào được tạo');
    }
    return instance;
  }

  /** Hàm tạo để tiêm vào `WEBSOCKET_FACTORY` của `GameSocket`. */
  static factory(): WebSocketFactory {
    return (url: string) => new FakeWebSocket(url);
  }

  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  private readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  /** Kết nối mở thành công. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Server gửi một khung tin xuống. */
  deliver(frame: string): void {
    this.onmessage?.({ data: frame });
  }

  /** Mất kết nối (server đóng hoặc mạng đứt). */
  fail(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Các gói client đã gửi, theo đúng thứ tự. */
  packets(): SentPacket[] {
    return this.sent.map((frame) => {
      const envelope = decodeEnvelope(frame);
      if (!envelope.ok) {
        throw new Error(`khung tin client gửi không hợp lệ: ${envelope.reason}`);
      }
      return {
        op: envelope.value.op,
        seq: envelope.value.seq,
        payload: envelope.value.payload,
      };
    });
  }

  /** Mã các gói client đã gửi, theo đúng thứ tự. */
  ops(): number[] {
    return this.packets().map((packet) => packet.op);
  }

  lastPacket(): SentPacket {
    const packets = this.packets();
    return packets[packets.length - 1];
  }
}

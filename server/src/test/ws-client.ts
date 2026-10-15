import { WebSocket } from 'ws';
import {
  OPCODE_NAMES,
  Opcode,
  PROTOCOL_VERSION,
  decodeEnvelope,
  encodePacket,
  type ErrorCode,
  type ServerEnterMap,
  type ServerError,
  type ServerHello,
} from '@ninja/shared';

/** Một gói tin server gửi xuống, đã bóc khung. */
export interface ReceivedPacket {
  readonly op: number;
  readonly payload: unknown;
}

interface Waiter {
  readonly predicate: (packet: ReceivedPacket) => boolean;
  readonly resolve: (packet: ReceivedPacket) => void;
  readonly timer: NodeJS.Timeout;
}

export interface HelloOptions {
  /** Access token lấy từ REST API (`/api/auth/register`). */
  access: string;
  protocolVersion?: number;
  characterId?: string;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Client WebSocket cho kiểm thử tích hợp: nối tới server thật, gom mọi gói tin nhận được, chờ gói
 * theo điều kiện và tự đóng khi dọn dẹp. Dùng `ws` (không phải trình duyệt) nên chạy thẳng trong
 * Vitest.
 */
export class TestGameClient {
  readonly closed: Promise<{ code: number; reason: string }>;

  private readonly received: ReceivedPacket[] = [];
  private readonly consumed = new Set<number>();
  private readonly waiters: Waiter[] = [];

  private constructor(private readonly socket: WebSocket) {
    this.closed = new Promise((resolve) => {
      socket.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf8') });
      });
    });

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        return;
      }
      const envelope = decodeEnvelope(data.toString('utf8'));
      if (envelope.ok) {
        this.received.push({ op: envelope.value.op, payload: envelope.value.payload });
        this.flush();
      }
    });
  }

  static async connect(url: string): Promise<TestGameClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => {
        resolve();
      });
      socket.once('error', reject);
    });
    return new TestGameClient(socket);
  }

  /** Gửi một gói tin client → server (đúng định dạng khung JSON). */
  send(op: number, payload: unknown = {}): void {
    this.socket.send(encodePacket(op, payload));
  }

  /** Gửi nguyên văn một khung text (dùng để thử dữ liệu sai định dạng). */
  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  /** Gửi gói bắt tay (mặc định dùng đúng phiên bản giao thức hiện tại). */
  sendHello(options: HelloOptions): void {
    this.send(Opcode.C2S_HELLO, {
      protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
      clientVersion: 'test',
      characterId: options.characterId,
      token: options.access,
    });
  }

  /** Bắt tay và chờ đủ `S2C_HELLO` + `S2C_ENTER_MAP`. */
  async hello(options: HelloOptions): Promise<{ hello: ServerHello; enterMap: ServerEnterMap }> {
    this.sendHello(options);
    const hello = await this.waitFor<ServerHello>(Opcode.S2C_HELLO);
    const enterMap = await this.waitFor<ServerEnterMap>(Opcode.S2C_ENTER_MAP);
    return { hello, enterMap };
  }

  /** Chờ một gói tin theo mã và điều kiện; hết thời gian thì ném lỗi. */
  waitFor<T>(
    op: number,
    predicate: (payload: unknown) => boolean = () => true,
    timeoutMs = 5000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        predicate: (packet) => packet.op === op && predicate(packet.payload),
        resolve: (packet) => {
          resolve(packet.payload as T);
        },
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          reject(
            new Error(
              `không nhận được gói ${OPCODE_NAMES[op] ?? op} trong ${timeoutMs} ms ` +
                `(đã nhận: ${this.received.map((packet) => OPCODE_NAMES[packet.op] ?? packet.op).join(', ') || 'không có gì'})`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      this.flush();
    });
  }

  /** Chờ `S2C_ERROR` (lọc theo mã nếu truyền vào). */
  waitForError(code?: ErrorCode, timeoutMs = 5000): Promise<ServerError> {
    return this.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => code === undefined || (payload as ServerError).code === code,
      timeoutMs,
    );
  }

  /** Mọi gói tin đã nhận, lọc theo mã nếu cần. */
  packets(op?: number): ReceivedPacket[] {
    return op === undefined ? [...this.received] : this.received.filter((p) => p.op === op);
  }

  /** Đánh dấu vị trí hiện tại trong danh sách gói đã nhận, dùng với `since`. */
  mark(): number {
    return this.received.length;
  }

  /** Các gói tin nhận được sau mốc `mark`. */
  since(mark: number, op?: number): ReceivedPacket[] {
    return this.received.slice(mark).filter((packet) => op === undefined || packet.op === op);
  }

  /** Đóng kết nối phía client và chờ tới khi đóng xong. */
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    await this.closed;
  }

  private flush(): void {
    for (const [index, packet] of this.received.entries()) {
      if (this.consumed.has(index)) {
        continue;
      }
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(packet));
      if (waiterIndex < 0) {
        continue;
      }
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timer);
      this.consumed.add(index);
      waiter.resolve(packet);
    }
  }
}

import { encodePacket, Opcode, type ErrorCode } from '@ninja/shared';
import type { GameSession } from './session.js';

/** Mã đóng theo chuẩn WebSocket: 1000 bình thường, 1001 đi nơi khác, 1002 lỗi giao thức. */
export const CLOSE_NORMAL = 1000;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_PROTOCOL_ERROR = 1002;
/** 4000–4999 dành cho ứng dụng: bị phiên mới cùng nhân vật đẩy ra. */
export const CLOSE_REPLACED_BY_NEW_LOGIN = 4000;

export type SessionState = 'awaiting-hello' | 'handshaking' | 'ready' | 'closed';

export interface ClientSessionOptions {
  connectionId: string;
  /** Ghi một gói tin đã mã hoá ra socket. */
  send: (raw: string) => void;
  /** Đóng socket. */
  close: (code: number, reason: string) => void;
  now?: () => number;
}

/**
 * Trạng thái của một kết nối WebSocket: số thứ tự gói tin, bắt tay xong hay chưa, và thời điểm
 * nhận gói tin cuối (để kiểm tra heartbeat). Không biết gì về luật chơi — phần đó ở `world/`.
 */
export class ClientSession implements GameSession {
  readonly connectionId: string;
  characterId: string | undefined;
  mapId: string | undefined;
  state: SessionState = 'awaiting-hello';
  /** Thời điểm nhận gói tin cuối cùng (ms kể từ epoch). */
  lastSeenAt: number;

  private seq = 0;
  private readonly now: () => number;
  private readonly write: (raw: string) => void;
  private readonly closeSocket: (code: number, reason: string) => void;

  constructor(options: ClientSessionOptions) {
    this.connectionId = options.connectionId;
    this.now = options.now ?? (() => Date.now());
    this.write = options.send;
    this.closeSocket = options.close;
    this.lastSeenAt = this.now();
  }

  get closed(): boolean {
    return this.state === 'closed';
  }

  /** Mọi gói tin nhận được đều tính là nhịp sống. */
  touch(): void {
    this.lastSeenAt = this.now();
  }

  /** Gói `C2S_HELLO` đã tới: đang xác thực, chưa được coi là đã bắt tay. */
  beginHandshake(): void {
    if (this.state === 'awaiting-hello') {
      this.state = 'handshaking';
    }
  }

  /** Bắt tay xong: từ đây mới nhận các gói tin thế giới. */
  markReady(): void {
    this.state = 'ready';
  }

  /** Socket đã đóng vì lý do ngoài tầm kiểm soát (client ngắt, lỗi mạng, server dừng). */
  markClosed(): void {
    this.state = 'closed';
  }

  send(op: number, payload: unknown): void {
    if (this.closed) {
      return;
    }
    this.write(encodePacket(op, payload, this.seq));
    this.seq += 1;
  }

  sendError(code: ErrorCode, message: string, fatal = false): void {
    this.send(Opcode.S2C_ERROR, { code, message, fatal });
  }

  sendNotify(message: string): void {
    this.send(Opcode.S2C_NOTIFY, { message });
  }

  /** Gửi lỗi rồi đóng kết nối (dùng cho mọi lỗi `fatal: true`). */
  sendFatalError(code: ErrorCode, message: string, closeCode = CLOSE_PROTOCOL_ERROR): void {
    this.sendError(code, message, true);
    this.close(closeCode, code);
  }

  replacedByNewLogin(): void {
    this.sendNotify('tài khoản của bạn vừa đăng nhập ở nơi khác, kết nối này bị đóng');
    this.close(CLOSE_REPLACED_BY_NEW_LOGIN, 'replaced');
  }

  close(code: number = CLOSE_GOING_AWAY, reason = 'close'): void {
    if (this.state === 'closed') {
      return;
    }
    this.state = 'closed';
    this.closeSocket(code, reason);
  }
}

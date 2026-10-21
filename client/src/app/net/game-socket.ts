import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import {
  ErrorCode,
  HEARTBEAT_INTERVAL_MS,
  Opcode,
  PROTOCOL_VERSION,
  decodeEnvelope,
  decodeServerPacket,
  encodePacket,
  type ClientHello,
  type ChatSend,
  type ChatSendChannel,
  type LeaderboardKind,
  type Pong,
  type ServerError,
  type ServerHello,
} from '@ninja/shared';
import { currentWsUrl } from './ws-url';

/** Phiên bản client gửi trong `C2S_HELLO` (trường `clientVersion`, tối đa 32 ký tự). */
export const CLIENT_VERSION = 'web-0.1.0';

/**
 * Khoá trường xác thực trong `C2S_HELLO` theo `ClientHelloSchema` của gói dùng chung.
 * Viết qua hằng số để dùng làm khoá tính toán khi dựng gói tin.
 */
const HELLO_CREDENTIAL_FIELD = 'token';

/** `readyState` của WebSocket khi kết nối đã mở. */
const SOCKET_OPEN = 1;

/** Số gói tối đa xếp hàng chờ bắt tay xong; vượt thì bỏ gói cũ nhất. */
export const MAX_QUEUED_PACKETS = 32;

export const CONNECTION_STATUSES = [
  'connecting',
  'handshaking',
  'ready',
  'closed',
  'error',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** Nhãn tiếng Việt cho HUD; tách khỏi trạng thái để trạng thái vẫn là định danh máy đọc được. */
export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Đang kết nối…',
  handshaking: 'Đang bắt tay…',
  ready: 'Đã kết nối',
  closed: 'Mất kết nối',
  error: 'Lỗi kết nối',
};

/** Lùi dần khi nối lại: 1s, 2s, 4s, 8s rồi giữ ở 15s. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;

export function reconnectDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index];
}

/**
 * Lỗi mức kết nối (`S2C_ERROR`). Ba mã dưới đây không thể tự khỏi nên client **không** nối lại:
 * giao thức lệch phải tải lại trang, token sai phải đăng nhập lại, chưa có nhân vật phải sang
 * trang tạo nhân vật. Các mã còn lại (chat quá nhanh, gói sai...) thì giữ kết nối.
 */
const UNRECOVERABLE_ERRORS: readonly string[] = [
  ErrorCode.PROTOCOL_MISMATCH,
  ErrorCode.UNAUTHORIZED,
  ErrorCode.NO_CHARACTER,
];

export interface SocketError {
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
}

export interface ConnectOptions {
  /** Access token của phiên đăng nhập, gửi trong trường xác thực của `C2S_HELLO`. */
  readonly credential: string;
  readonly characterId?: string;
}

export type PacketListener = (op: number, payload: unknown) => void;

/**
 * Mặt tối thiểu của `WebSocket` mà lớp socket dùng. Nhờ khai báo này, kiểm thử thay được
 * WebSocket giả mà không cần mạng; mã chạy thật vẫn dùng `WebSocket` gốc của trình duyệt.
 */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export const WEBSOCKET_FACTORY = new InjectionToken<WebSocketFactory>('ninja.websocket-factory', {
  providedIn: 'root',
  factory: () => (url: string) => new WebSocket(url) as unknown as WebSocketLike,
});

/** Đồng hồ dùng cho ping; tách ra để kiểm thử bơm được thời gian giả. */
export const CLOCK = new InjectionToken<() => number>('ninja.clock', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

/**
 * Kết nối WebSocket của game, dùng `WebSocket` gốc của trình duyệt (không thêm thư viện).
 *
 * Trách nhiệm:
 * 1. Mở kết nối tới `/ws` cùng origin và gửi `C2S_HELLO` **trước mọi gói khác**; các gói khác
 *    gửi trong lúc chưa có `S2C_HELLO` được xếp hàng rồi gửi lại theo đúng thứ tự.
 * 2. Giữ trạng thái bằng signals: `connecting → handshaking → ready`, hoặc `closed`/`error`.
 * 3. Tự nối lại khi mất kết nối với thời gian lùi dần (1s → 15s), bắt tay lại, và tăng
 *    `connectionEpoch` để tầng trên biết phải nạp lại map.
 * 4. Gửi `C2S_PING` mỗi `HEARTBEAT_INTERVAL_MS` và đo độ trễ từ `S2C_PONG`.
 * 5. Kiểm mọi gói nhận được bằng `decodeServerPacket`; gói sai bị bỏ qua kèm log, không làm
 *    sập ứng dụng.
 *
 * Service **không** tự kết nối: trang `/play` gọi `connect()` khi đã biết nhân vật.
 */
@Injectable({ providedIn: 'root' })
export class GameSocket {
  private readonly createSocket = inject(WEBSOCKET_FACTORY);
  private readonly clock = inject(CLOCK);

  private readonly statusSignal = signal<ConnectionStatus>('closed');
  private readonly errorSignal = signal<SocketError | null>(null);
  private readonly helloSignal = signal<ServerHello | null>(null);
  private readonly latencySignal = signal<number | null>(null);
  private readonly epochSignal = signal(0);

  readonly status = this.statusSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly serverHello = this.helloSignal.asReadonly();
  readonly latencyMs = this.latencySignal.asReadonly();
  /** Tăng một lần mỗi khi bắt tay xong; tầng trên dùng để nạp lại thế giới. */
  readonly connectionEpoch = this.epochSignal.asReadonly();
  readonly isReady = computed(() => this.statusSignal() === 'ready');

  private socket: WebSocketLike | null = null;
  private options: ConnectOptions | null = null;
  private readonly queue: string[] = [];
  private readonly listeners = new Set<PacketListener>();

  private started = false;
  private fatal = false;
  private attempt = 0;
  private seq = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  /** Kết nối tới máy chủ và bắt tay bằng token của phiên đăng nhập hiện tại. */
  connect(options: ConnectOptions): void {
    this.closeSocket();
    this.options = options;
    this.started = true;
    this.fatal = false;
    this.attempt = 0;
    this.errorSignal.set(null);
    this.latencySignal.set(null);
    this.queue.length = 0;
    this.open();
  }

  /** Đóng kết nối và **không** nối lại (rời trang, đăng xuất). */
  disconnect(): void {
    this.started = false;
    this.fatal = false;
    this.clearReconnectTimer();
    this.closeSocket();
    this.stopHeartbeat();
    this.queue.length = 0;
    this.latencySignal.set(null);
    this.statusSignal.set('closed');
  }

  /**
   * Gửi một gói tin. Chưa bắt tay xong thì gói được xếp hàng và gửi sau `S2C_HELLO`.
   * Trả về `false` khi gói bị bỏ hẳn (chưa từng gọi `connect()`).
   */
  send(op: number, payload: unknown): boolean {
    if (!this.options) {
      return false;
    }
    const frame = encodePacket(op, payload, this.nextSeq());
    if (this.statusSignal() !== 'ready') {
      this.enqueue(frame);
      return true;
    }
    this.write(frame);
    return true;
  }

  // --------------------------------------------------- xã hội & Lôi Đài (M6)

  /**
   * Gửi một tin nhắn chat.
   *
   * Tin `private` **phải** kèm `to`; các kênh khác **không** được kèm — `ChatSendSchema` của gói
   * dùng chung từ chối cả hai trường hợp sai, nên chỗ này chỉ dựng đúng hình dạng gói.
   */
  sendChat(channel: ChatSendChannel, text: string, to?: string): boolean {
    const payload: ChatSend = to === undefined ? { channel, text } : { channel, text, to };
    return this.send(Opcode.C2S_CHAT, payload);
  }

  requestFriend(name: string): boolean {
    return this.send(Opcode.C2S_FRIEND_REQUEST, { name });
  }

  acceptFriend(name: string): boolean {
    return this.send(Opcode.C2S_FRIEND_ACCEPT, { name });
  }

  declineFriend(name: string): boolean {
    return this.send(Opcode.C2S_FRIEND_DECLINE, { name });
  }

  removeFriend(name: string): boolean {
    return this.send(Opcode.C2S_FRIEND_REMOVE, { name });
  }

  inviteParty(name: string): boolean {
    return this.send(Opcode.C2S_PARTY_INVITE, { name });
  }

  /** Trả lời lời mời vào đội: địa chỉ là **đội trưởng** đã mời mình. */
  acceptParty(leaderName: string): boolean {
    return this.send(Opcode.C2S_PARTY_ACCEPT, { leaderName });
  }

  declineParty(leaderName: string): boolean {
    return this.send(Opcode.C2S_PARTY_DECLINE, { leaderName });
  }

  leaveParty(): boolean {
    return this.send(Opcode.C2S_PARTY_LEAVE, {});
  }

  kickParty(name: string): boolean {
    return this.send(Opcode.C2S_PARTY_KICK, { name });
  }

  claimMail(mailId: string): boolean {
    return this.send(Opcode.C2S_MAIL_CLAIM, { mailId });
  }

  arenaQueue(): boolean {
    return this.send(Opcode.C2S_ARENA_QUEUE, {});
  }

  arenaCancel(): boolean {
    return this.send(Opcode.C2S_ARENA_CANCEL, {});
  }

  requestLeaderboard(board: LeaderboardKind): boolean {
    return this.send(Opcode.C2S_LEADERBOARD, { board });
  }

  /** Đăng ký nghe mọi gói server gửi xuống (đã kiểm bằng `decodeServerPacket`). */
  onPacket(listener: PacketListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ------------------------------------------------------------------ nội bộ

  private open(): void {
    if (!this.started || !this.options) {
      return;
    }
    this.clearReconnectTimer();
    this.statusSignal.set('connecting');

    let socket: WebSocketLike;
    try {
      socket = this.createSocket(currentWsUrl());
    } catch (error) {
      console.warn('[net] không mở được WebSocket', error);
      this.statusSignal.set('closed');
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.statusSignal.set('handshaking');
      this.sendHello();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleFrame(event.data);
    };
    socket.onerror = () => {
      // Trình duyệt không cho biết lý do; sự kiện `close` ngay sau đó mới quyết định nối lại.
      console.warn('[net] lỗi kết nối WebSocket');
    };
    socket.onclose = () => {
      this.handleClose(socket);
    };
  }

  private handleClose(socket: WebSocketLike): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.stopHeartbeat();
    if (this.fatal) {
      // Đã có `S2C_ERROR` nghiêm trọng: giữ trạng thái `error` để giao diện hiện hướng dẫn.
      return;
    }
    this.statusSignal.set('closed');
    if (this.started) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.fatal) {
      return;
    }
    const delay = reconnectDelay(this.attempt);
    this.attempt += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Đóng kết nối đã hỏng cũng không sao.
      }
    }
  }

  private sendHello(): void {
    const options = this.options;
    if (!options) {
      return;
    }
    const hello: ClientHello = {
      [HELLO_CREDENTIAL_FIELD]: options.credential,
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: CLIENT_VERSION,
      ...(options.characterId ? { characterId: options.characterId } : {}),
    };
    this.write(encodePacket(Opcode.C2S_HELLO, hello, this.nextSeq()));
  }

  private handleFrame(data: unknown): void {
    if (typeof data !== 'string') {
      console.warn('[net] bỏ qua khung tin không phải văn bản');
      return;
    }
    const envelope = decodeEnvelope(data);
    if (!envelope.ok) {
      console.warn(`[net] bỏ qua khung tin sai: ${envelope.reason}`);
      return;
    }
    const packet = decodeServerPacket(envelope.value.op, envelope.value.payload);
    if (!packet.ok) {
      console.warn(`[net] bỏ qua gói tin sai (op=${packet.op}): ${packet.reason}`);
      return;
    }
    this.dispatch(envelope.value.op, packet.value);
  }

  private dispatch(op: number, payload: unknown): void {
    if (op === Opcode.S2C_HELLO) {
      this.applyHello(payload as ServerHello);
    } else if (op === Opcode.S2C_PONG) {
      this.applyPong(payload as Pong);
    } else if (op === Opcode.S2C_ERROR) {
      this.applyServerError(payload as ServerError);
    }

    for (const listener of this.listeners) {
      try {
        listener(op, payload);
      } catch (error) {
        // Một người nghe lỗi không được làm sập cả phiên chơi.
        console.warn('[net] người nghe gói tin báo lỗi', error);
      }
    }
  }

  private applyHello(hello: ServerHello): void {
    this.helloSignal.set(hello);
    this.attempt = 0;
    this.statusSignal.set('ready');
    this.flushQueue();
    this.startHeartbeat();
    this.epochSignal.update((epoch) => epoch + 1);
  }

  private applyPong(pong: Pong): void {
    const rtt = this.clock() - pong.clientTime;
    this.latencySignal.set(Math.max(0, Math.round(rtt)));
  }

  private applyServerError(error: ServerError): void {
    this.errorSignal.set({
      code: error.code,
      message: error.message,
      fatal: error.fatal || UNRECOVERABLE_ERRORS.includes(error.code),
    });
    if (this.errorSignal()?.fatal !== true) {
      return;
    }
    // Lỗi không thể tự khỏi: dừng nối lại để không lặp vô hạn, giữ thông báo cho giao diện.
    this.fatal = true;
    this.started = false;
    this.attempt = 0;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.queue.length = 0;
    this.statusSignal.set('error');
    this.closeSocket();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.ping();
    this.heartbeatTimer = setInterval(() => this.ping(), HEARTBEAT_INTERVAL_MS);
  }

  private ping(): void {
    this.send(Opcode.C2S_PING, { clientTime: this.clock() });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private enqueue(frame: string): void {
    if (this.queue.length >= MAX_QUEUED_PACKETS) {
      // Giữ ý định mới nhất: bỏ gói cũ nhất khi hàng đợi đầy.
      this.queue.shift();
    }
    this.queue.push(frame);
  }

  private flushQueue(): void {
    const frames = this.queue.splice(0, this.queue.length);
    for (const frame of frames) {
      this.write(frame);
    }
  }

  private write(frame: string): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      this.enqueue(frame);
      return;
    }
    try {
      socket.send(frame);
    } catch (error) {
      console.warn('[net] không gửi được gói tin', error);
    }
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }
}

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  CHAT_MAX_LENGTH,
  ErrorCode,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  OPCODE_NAMES,
  Opcode,
  decodeClientPacket,
  decodeEnvelope,
  type AttackMob,
  type BattleAction,
  type ChatSend,
  type ClientHello,
  type EnterMap,
  type Equip,
  type Move,
  type NpcTalk,
  type Ping,
  type PersonName,
  type PartyInvite,
  type PartyReply,
  type MailClaim,
  type LeaderboardRequest,
  type QuestAccept,
  type QuestComplete,
  type ShopBuy,
  type ShopSell,
  type Unequip,
  type Upgrade,
  type UseItem,
} from '@ninja/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { TickScheduler } from '../core/tick.js';
import { HandshakeError } from '../world/handshake-error.js';
import type { WorldService } from '../world/world-service.js';
import { CLOSE_GOING_AWAY, CLOSE_PROTOCOL_ERROR, ClientSession } from './client-session.js';

/** Gói đầu tiên phải là `C2S_HELLO` trong khoảng thời gian này, nếu không thì đóng kết nối. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Đường dẫn WebSocket mặc định, dùng chung cổng HTTP với REST API. */
export const DEFAULT_WS_PATH = '/ws';

export interface WebSocketGatewayOptions {
  app: FastifyInstance;
  world: WorldService;
  /** Nhịp dùng chung: gateway dùng nó để quét heartbeat, không tự mở interval riêng. */
  tick: TickScheduler;
  path?: string;
  handshakeTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
}

/**
 * Cổng WebSocket gắn vào chính server HTTP của Fastify (`noServer` + sự kiện `upgrade`), nên chỉ
 * có **một cổng** cho cả REST API và realtime. Gateway lo phần vận chuyển: đọc khung JSON, giữ
 * trạng thái bắt tay, heartbeat, đóng kết nối; luật chơi nằm ở `WorldService`.
 */
export class WebSocketGateway {
  private readonly path: string;
  private readonly handshakeTimeoutMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly sessions = new Set<ClientSession>();
  private readonly sockets = new Map<ClientSession, WebSocket>();
  private readonly handshakeTimers = new Map<string, NodeJS.Timeout>();
  /** Hàng đợi theo từng kết nối: gói tin được xử lý tuần tự, đúng thứ tự nhận. */
  private readonly queues = new WeakMap<ClientSession, Promise<void>>();

  private server: WebSocketServer | undefined;
  private unsubscribeTick: (() => void) | undefined;
  private upgradeListener:
    ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;

  constructor(private readonly options: WebSocketGatewayOptions) {
    this.path = options.path ?? DEFAULT_WS_PATH;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  }

  /** Số kết nối đang mở (kể cả chưa bắt tay) — dùng cho log và kiểm thử. */
  get connectionCount(): number {
    return this.sessions.size;
  }

  /** Gắn vào Fastify: bắt sự kiện `upgrade` của server HTTP và quét heartbeat theo nhịp chung. */
  attach(): void {
    if (this.server) {
      return;
    }
    this.server = new WebSocketServer({ noServer: true });
    this.upgradeListener = (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    };
    this.options.app.server.on('upgrade', this.upgradeListener);
    this.unsubscribeTick = this.options.tick.onTick(() => {
      this.checkHeartbeats();
    });
    // `preClose` chạy **trước** khi server HTTP đóng: phải đóng socket WebSocket ở đây, vì
    // `app.close()` sẽ chờ mãi nếu còn kết nối WebSocket đang mở (`onClose` chỉ chạy sau đó).
    this.options.app.addHook('preClose', async () => {
      this.close();
    });
    // Đăng ký thêm `onClose` (gọi lại vô hại) để dù app đóng theo đường nào cũng dọn sạch.
    this.options.app.addHook('onClose', async () => {
      this.close();
    });
  }

  /** Đóng mọi kết nối, dừng quét heartbeat và gỡ listener (gọi khi `app.close()`). */
  close(): void {
    this.unsubscribeTick?.();
    this.unsubscribeTick = undefined;

    if (this.upgradeListener) {
      this.options.app.server.off('upgrade', this.upgradeListener);
      this.upgradeListener = undefined;
    }

    for (const timer of this.handshakeTimers.values()) {
      clearTimeout(timer);
    }
    this.handshakeTimers.clear();

    for (const session of [...this.sessions]) {
      // Dọn khỏi room ngay, không chờ socket đóng hẳn.
      this.options.world.leave(session);
      session.markClosed();
    }
    this.sessions.clear();

    for (const socket of this.sockets.values()) {
      socket.terminate();
    }
    this.sockets.clear();

    this.server?.close();
    this.server = undefined;
  }

  // ------------------------------------------------------------- vòng đời socket

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const server = this.server;
    if (!server) {
      socket.destroy();
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== this.path) {
      // Không phải đường dẫn WebSocket của game: trả 404 rồi đóng, không để socket treo.
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    server.handleUpgrade(request, socket, head, (client) => {
      this.accept(client);
    });
  }

  private accept(socket: WebSocket): void {
    const session = new ClientSession({
      connectionId: randomUUID(),
      send: (raw) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(raw);
        }
      },
      close: (code, reason) => {
        socket.close(code, reason);
      },
    });

    this.sessions.add(session);
    this.sockets.set(session, socket);

    const timer = setTimeout(() => {
      this.onHandshakeTimeout(session);
    }, this.handshakeTimeoutMs);
    timer.unref();
    this.handshakeTimers.set(session.connectionId, timer);

    socket.on('message', (data, isBinary) => {
      this.onMessage(session, data, isBinary);
    });
    socket.on('close', () => {
      this.onSocketClosed(session);
    });
    socket.on('error', (error: Error) => {
      this.options.app.log.warn(
        { err: error, connectionId: session.connectionId },
        'lỗi kết nối WebSocket',
      );
    });
  }

  private onSocketClosed(session: ClientSession): void {
    this.clearHandshakeTimer(session);
    this.sessions.delete(session);
    this.sockets.delete(session);
    session.markClosed();
    this.options.world.leave(session);
  }

  private onHandshakeTimeout(session: ClientSession): void {
    if (session.state === 'ready' || session.closed) {
      return;
    }
    this.failFatal(
      session,
      ErrorCode.BAD_PACKET,
      `không bắt tay trong ${Math.round(this.handshakeTimeoutMs / 1000)} giây — gói đầu tiên phải là C2S_HELLO`,
    );
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const session of [...this.sessions]) {
      if (session.closed || now - session.lastSeenAt <= this.heartbeatTimeoutMs) {
        continue;
      }
      this.failFatal(
        session,
        ErrorCode.BAD_PACKET,
        `không nhận được gói tin nào trong ${Math.round(this.heartbeatTimeoutMs / 1000)} giây — ` +
          `client phải gửi C2S_PING ít nhất mỗi ${HEARTBEAT_INTERVAL_MS / 1000} giây`,
        CLOSE_GOING_AWAY,
      );
    }
  }

  private clearHandshakeTimer(session: ClientSession): void {
    const timer = this.handshakeTimers.get(session.connectionId);
    if (timer) {
      clearTimeout(timer);
      this.handshakeTimers.delete(session.connectionId);
    }
  }

  /** Gửi lỗi fatal rồi đóng kết nối và dọn khỏi thế giới ngay. */
  private failFatal(
    session: ClientSession,
    code: ErrorCode,
    message: string,
    closeCode = CLOSE_PROTOCOL_ERROR,
  ): void {
    session.sendError(code, message, true);
    this.endSession(session, closeCode, code);
  }

  private endSession(session: ClientSession, code: number, reason: string): void {
    if (session.closed) {
      return;
    }
    session.close(code, reason);
    this.options.world.leave(session);
  }

  // ---------------------------------------------------------------- nhận gói tin

  private onMessage(session: ClientSession, data: RawData, isBinary: boolean): void {
    // Đổi sang chuỗi ngay (ws có thể dùng lại buffer) rồi xử lý tuần tự theo hàng đợi của kết nối.
    const text = isBinary ? undefined : rawToText(data);
    const previous = this.queues.get(session) ?? Promise.resolve();
    const next = previous
      .then(() => this.process(session, text))
      .catch((error: unknown) => {
        this.onUnexpectedError(session, error);
      });
    this.queues.set(session, next);
  }

  private async process(session: ClientSession, text: string | undefined): Promise<void> {
    if (session.closed) {
      return;
    }
    session.touch();

    if (text === undefined) {
      this.failFatal(session, ErrorCode.BAD_PACKET, 'chỉ nhận khung JSON dạng text frame');
      return;
    }

    const envelope = decodeEnvelope(text);
    if (!envelope.ok) {
      this.failFatal(session, ErrorCode.BAD_PACKET, `không đọc được gói tin: ${envelope.reason}`);
      return;
    }

    const { op, payload } = envelope.value;
    if (session.state === 'ready') {
      await this.dispatch(session, op, payload);
      return;
    }

    // Chưa bắt tay: chỉ chấp nhận C2S_HELLO, mọi gói khác là vi phạm giao thức.
    if (op !== Opcode.C2S_HELLO) {
      this.failFatal(
        session,
        ErrorCode.BAD_PACKET,
        `gói đầu tiên phải là C2S_HELLO, nhận được ${OPCODE_NAMES[op] ?? op}`,
      );
      return;
    }

    const hello = this.decode<ClientHello>(session, op, payload);
    if (!hello) {
      return;
    }
    await this.startWorld(session, hello);
  }

  private async startWorld(session: ClientSession, hello: ClientHello): Promise<void> {
    session.beginHandshake();
    try {
      await this.options.world.handshake(session, hello);
    } catch (error) {
      if (error instanceof HandshakeError) {
        if (!session.closed) {
          this.failFatal(session, error.code, error.message);
        }
        return;
      }
      throw error;
    }
    this.clearHandshakeTimer(session);
    if (!session.closed) {
      session.markReady();
    }
  }

  private async dispatch(session: ClientSession, op: number, payload: unknown): Promise<void> {
    const world = this.options.world;

    switch (op) {
      case Opcode.C2S_PING: {
        const ping = this.decode<Ping>(session, op, payload);
        if (ping) {
          world.ping(session, ping);
        }
        return;
      }
      case Opcode.C2S_MOVE: {
        const move = this.decode<Move>(session, op, payload);
        if (move) {
          world.move(session, move);
        }
        return;
      }
      case Opcode.C2S_ENTER_MAP: {
        const request = this.decode<EnterMap>(session, op, payload);
        if (request) {
          world.enterMap(session, request);
        }
        return;
      }
      case Opcode.C2S_CHAT: {
        // Tin quá dài và gửi quá nhanh đều là vi phạm giới hạn tần suất → cùng mã `rate_limited`.
        const chat = this.decode<ChatSend>(session, op, payload, ErrorCode.RATE_LIMITED);
        if (chat) {
          await world.chat(session, chat);
        }
        return;
      }
      case Opcode.C2S_NPC_TALK: {
        const talk = this.decode<NpcTalk>(session, op, payload);
        if (talk) {
          await world.talkToNpc(session, talk);
        }
        return;
      }
      case Opcode.C2S_QUEST_ACCEPT: {
        const request = this.decode<QuestAccept>(session, op, payload);
        if (request) {
          await world.questAccept(session, request);
        }
        return;
      }
      case Opcode.C2S_QUEST_COMPLETE: {
        const request = this.decode<QuestComplete>(session, op, payload);
        if (request) {
          await world.questComplete(session, request);
        }
        return;
      }
      case Opcode.C2S_ATTACK_MOB: {
        const attack = this.decode<AttackMob>(session, op, payload);
        if (attack) {
          world.attackMonster(session, attack);
        }
        return;
      }
      case Opcode.C2S_BATTLE_ACTION: {
        const action = this.decode<BattleAction>(session, op, payload);
        if (action) {
          world.battleAction(session, action);
        }
        return;
      }
      case Opcode.C2S_ARENA_QUEUE:
        if (this.decode(session, op, payload)) await world.arenaQueue(session);
        return;
      case Opcode.C2S_ARENA_CANCEL:
        if (this.decode(session, op, payload)) await world.arenaCancel(session);
        return;
      case Opcode.C2S_USE_ITEM: {
        const use = this.decode<UseItem>(session, op, payload);
        if (use) {
          world.useItem(session, use);
        }
        return;
      }
      case Opcode.C2S_EQUIP: {
        const request = this.decode<Equip>(session, op, payload);
        if (request) {
          await world.equip(session, request);
        }
        return;
      }
      case Opcode.C2S_UNEQUIP: {
        const request = this.decode<Unequip>(session, op, payload);
        if (request) {
          await world.unequip(session, request);
        }
        return;
      }
      case Opcode.C2S_SHOP_BUY: {
        const request = this.decode<ShopBuy>(session, op, payload);
        if (request) {
          await world.shopBuy(session, request);
        }
        return;
      }
      case Opcode.C2S_SHOP_SELL: {
        const request = this.decode<ShopSell>(session, op, payload);
        if (request) {
          await world.shopSell(session, request);
        }
        return;
      }
      case Opcode.C2S_UPGRADE: {
        const request = this.decode<Upgrade>(session, op, payload);
        if (request) {
          await world.upgrade(session, request);
        }
        return;
      }
      case Opcode.C2S_FRIEND_REQUEST:
      case Opcode.C2S_FRIEND_ACCEPT:
      case Opcode.C2S_FRIEND_DECLINE:
      case Opcode.C2S_FRIEND_REMOVE: {
        const request = this.decode<PersonName>(session, op, payload);
        if (request) {
          const action = op === Opcode.C2S_FRIEND_REQUEST ? 'request'
            : op === Opcode.C2S_FRIEND_ACCEPT ? 'accept'
              : op === Opcode.C2S_FRIEND_DECLINE ? 'decline' : 'remove';
          await world.friend(session, action, request.name);
        }
        return;
      }
      case Opcode.C2S_PARTY_INVITE:
      case Opcode.C2S_PARTY_KICK: {
        const request = this.decode<PartyInvite>(session, op, payload);
        if (request) await world.partyCommand(session, op === Opcode.C2S_PARTY_INVITE ? 'invite' : 'kick', request.name);
        return;
      }
      case Opcode.C2S_PARTY_ACCEPT:
      case Opcode.C2S_PARTY_DECLINE: {
        const request = this.decode<PartyReply>(session, op, payload);
        if (request) await world.partyCommand(session, op === Opcode.C2S_PARTY_ACCEPT ? 'accept' : 'decline', request.leaderName);
        return;
      }
      case Opcode.C2S_PARTY_LEAVE:
        if (this.decode(session, op, payload)) await world.partyCommand(session, 'leave');
        return;
      case Opcode.C2S_MAIL_CLAIM: {
        const request = this.decode<MailClaim>(session, op, payload);
        if (request) await world.claimMail(session, request.mailId);
        return;
      }
      case Opcode.C2S_LEADERBOARD: {
        const request = this.decode<LeaderboardRequest>(session, op, payload);
        if (request) await world.leaderboard(session, request);
        return;
      }
      case Opcode.C2S_HELLO:
        session.sendError(ErrorCode.BAD_PACKET, 'đã bắt tay rồi, không gửi C2S_HELLO lần nữa');
        return;
      default:
        session.sendError(ErrorCode.BAD_PACKET, `mã gói tin không hỗ trợ: ${op}`);
    }
  }

  /** Kiểm phần thân gói tin; sai thì báo lỗi (không fatal) và trả `undefined`. */
  private decode<T>(
    session: ClientSession,
    op: number,
    payload: unknown,
    failureCode: ErrorCode = ErrorCode.BAD_PACKET,
  ): T | undefined {
    const decoded = decodeClientPacket(op, payload);
    if (decoded.ok) {
      return decoded.value as T;
    }
    const name = OPCODE_NAMES[op] ?? op;
    const message =
      failureCode === ErrorCode.RATE_LIMITED
        ? `tin nhắn không hợp lệ (tối đa ${CHAT_MAX_LENGTH} ký tự) hoặc gửi quá nhanh`
        : `${name} không hợp lệ: ${decoded.reason}`;
    session.sendError(failureCode, message);
    return undefined;
  }

  private onUnexpectedError(session: ClientSession, error: unknown): void {
    this.options.app.log.error(
      { err: error, connectionId: session.connectionId },
      'lỗi khi xử lý gói tin WebSocket',
    );
    if (!session.closed) {
      session.sendError(ErrorCode.INTERNAL, 'lỗi hệ thống, hãy thử lại sau');
    }
  }
}

/** `ws` đưa về Buffer, ArrayBuffer hoặc mảng Buffer (khung bị phân mảnh). */
function rawToText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return data.toString('utf8');
}

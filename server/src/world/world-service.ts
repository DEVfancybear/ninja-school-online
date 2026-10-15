import {
  CHAT_MIN_INTERVAL_MS,
  ErrorCode,
  Opcode,
  PROTOCOL_VERSION,
  TICK_RATE_MS,
  type Character,
  type ChatSend,
  type ClientHello,
  type EnterMap,
  type Move,
  type NpcTalk,
  type Ping,
  type ServerEnterMap,
  type ServerHello,
} from '@ninja/shared';
import type { RoomManager } from '../core/room-manager.js';
import type { ChatService } from '../modules/chat/service.js';
import type { CharacterService } from '../modules/character/service.js';
import type { NpcService } from '../modules/npc/service.js';
import type { GameSession } from '../net/session.js';
import type { SessionRegistry } from '../net/session-registry.js';
import { GameDataError, type GameData } from './game-data.js';
import { HandshakeError } from './handshake-error.js';
import type { MapPortal } from './map.js';
import { checkMove, MOVE_REJECTION_MESSAGES } from './movement.js';
import { createPlayer, playerView, type Room, type RoomPlayer } from './room.js';

/**
 * Bản đồ và điểm spawn khi vào game. **M2 chưa lưu vị trí vào database**: mỗi lần kết nối đều vào
 * đúng bản đồ khởi đầu này, ở đúng điểm spawn `default`.
 */
export const START_MAP_ID = 'lang-khoi-nguon';
export const START_SPAWN_ID = 'default';

export interface WorldServiceOptions {
  gameData: GameData;
  rooms: RoomManager;
  sessions: SessionRegistry;
  characters: CharacterService;
  chat: ChatService;
  npcs: NpcService;
  /** Xác thực access token (dùng `app.jwt`); trả `undefined` nếu token sai hoặc hết hạn. */
  verifyToken: (token: string) => AccountToken | undefined;
  now?: () => number;
}

export interface AccountToken {
  readonly sub: string;
  readonly username: string;
}

/**
 * Nguồn sự thật của thế giới: bắt tay, vào/đổi bản đồ, di chuyển, chat, hội thoại NPC.
 * Mọi quyết định đều ở đây; tầng `net/` chỉ lo vận chuyển, `modules/` lo luật của từng hệ thống.
 */
export class WorldService {
  private readonly now: () => number;

  constructor(private readonly options: WorldServiceOptions) {
    this.now = options.now ?? (() => Date.now());

    if (!options.gameData.maps.has(START_MAP_ID)) {
      throw new GameDataError([
        {
          file: 'maps/',
          path: START_MAP_ID,
          message: `thiếu bản đồ khởi đầu "${START_MAP_ID}" trong game-data/maps/`,
        },
      ]);
    }
  }

  /**
   * Bắt tay: xác thực token → kiểm phiên bản giao thức → chọn nhân vật → đưa vào bản đồ khởi đầu.
   * Ném `HandshakeError` (fatal) khi từ chối.
   */
  async handshake(session: GameSession, hello: ClientHello): Promise<void> {
    const account = this.options.verifyToken(hello.token);
    if (!account) {
      throw new HandshakeError(
        ErrorCode.UNAUTHORIZED,
        'phiên đăng nhập không hợp lệ hoặc đã hết hạn, hãy đăng nhập lại',
      );
    }

    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      throw new HandshakeError(
        ErrorCode.PROTOCOL_MISMATCH,
        `phiên bản giao thức không khớp: server dùng ${PROTOCOL_VERSION}, ` +
          `client gửi ${hello.protocolVersion} — hãy tải lại trang`,
      );
    }

    const character = await this.options.characters.pickForWorld(account.sub, hello.characterId);
    if (!character) {
      throw hello.characterId
        ? new HandshakeError(
            ErrorCode.BAD_PACKET,
            'nhân vật này không thuộc tài khoản đang đăng nhập',
          )
        : new HandshakeError(
            ErrorCode.NO_CHARACTER,
            'tài khoản chưa có nhân vật nào — hãy vào trang tạo nhân vật rồi quay lại',
          );
    }

    // Token hợp lệ nhưng kết nối đã bị đóng trong lúc chờ database: đừng thêm thực thể ma.
    if (session.closed) {
      return;
    }

    const room = this.options.rooms.getOrCreate(START_MAP_ID);
    const spawn = room?.map.spawnPosition(START_SPAWN_ID) ?? room?.map.defaultSpawn();
    if (!room || !spawn) {
      throw new HandshakeError(
        ErrorCode.INTERNAL,
        `bản đồ khởi đầu "${START_MAP_ID}" không có điểm spawn "${START_SPAWN_ID}"`,
      );
    }

    this.evictPreviousSessions(session, character.id);

    const player = createPlayer({ character, position: spawn, channel: session });
    room.addPlayer(player);
    session.characterId = character.id;
    session.mapId = room.map.id;

    session.send(Opcode.S2C_HELLO, this.helloPayload(character, room.map.id));
    this.sendEnterMap(session, room, player);
    // Người đã ở trong map mới biết có người vừa vào.
    room.broadcast(Opcode.S2C_ENTITY_ADD, { entity: playerView(player) }, player.id);
  }

  /**
   * `C2S_MOVE`: kiểm khoảng cách / biên bản đồ / ô bị chặn. Sai thì báo lỗi và **không** đổi vị trí;
   * đúng thì đặt đích và để `Room.tick()` đẩy dần mỗi nhịp.
   */
  move(session: GameSession, move: Move): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    const { room, player } = located;

    const rejection = checkMove(room.map, { x: player.x, y: player.y }, move);
    if (rejection) {
      session.sendError(ErrorCode.BAD_PACKET, MOVE_REJECTION_MESSAGES[rejection]);
      return;
    }
    player.target = { x: move.x, y: move.y };
  }

  /**
   * `C2S_ENTER_MAP`: chỉ hợp lệ khi người chơi đang đứng trong vùng một cổng của map hiện tại dẫn
   * tới bản đồ đó. Điểm đến do cổng trong game-data quyết định, **không** dùng `spawnId` client gửi.
   *
   * Từ khi cổng tự kích hoạt lúc đi bộ (`enterPortal`), gói này là đường chủ động dành cho tính
   * năng sau này (dịch chuyển, cắt cảnh) và cho client công cụ; luật kiểm tra vẫn giữ nguyên.
   */
  enterMap(session: GameSession, request: EnterMap): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    const { room, player } = located;

    const portal = room.map.portalAt(player.x, player.y);
    if (!portal || portal.toMap !== request.mapId) {
      session.sendError(
        ErrorCode.UNKNOWN_MAP,
        'bạn phải đứng trong vùng cổng dẫn tới bản đồ đó mới đi được',
      );
      return;
    }

    this.transfer(room, player, portal, session);
  }

  /**
   * Người chơi **bước vào vùng cổng** trong lúc đi (`Room.tick()` báo lên): đổi bản đồ ngay, không
   * cần client xin phép. Server đã biết vị trí nên cổng là một phần của bản đồ, không phải một
   * hành động của người chơi.
   */
  enterPortal(room: Room, player: RoomPlayer, portal: MapPortal): void {
    const session = this.options.sessions.get(player.id);
    if (!session) {
      // Nhân vật không còn phiên nào (vừa bị đẩy ra hoặc vừa ngắt kết nối): không có gì để chuyển.
      return;
    }
    this.transfer(room, player, portal, session);
  }

  /** `C2S_CHAT`: giới hạn tần suất theo từng người, rồi phát cho cả room kèm lịch sử gần nhất. */
  chat(session: GameSession, chat: ChatSend): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    const { room, player } = located;

    if (!this.options.chat.allow(player.id)) {
      session.sendError(
        ErrorCode.RATE_LIMITED,
        `chậm thôi — mỗi ${CHAT_MIN_INTERVAL_MS / 1000} giây chỉ gửi được một tin nhắn`,
      );
      return;
    }

    room.sendChat(this.options.chat.mapMessage(player, chat.text, this.now()));
  }

  /** `C2S_NPC_TALK`: chỉ trả lời NPC đang có trong bản đồ hiện tại. */
  talkToNpc(session: GameSession, talk: NpcTalk): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }

    const npc = located.room.getNpc(talk.npcId);
    if (!npc) {
      session.sendError(ErrorCode.UNKNOWN_ENTITY, 'không có NPC này trong bản đồ hiện tại');
      return;
    }

    session.send(Opcode.S2C_NPC_DIALOG, this.options.npcs.dialog(npc));
  }

  /** `C2S_PING` → `S2C_PONG` (trả lại `clientTime` để client đo độ trễ). */
  ping(session: GameSession, ping: Ping): void {
    session.send(Opcode.S2C_PONG, { clientTime: ping.clientTime, serverTime: this.now() });
  }

  /**
   * Người chơi rời thế giới: ngắt kết nối, chuyển map, hoặc bị phiên mới đẩy ra. Gọi lại nhiều lần
   * đều vô hại (idempotent) vì tầng `net/` có thể gọi cả khi chủ động đóng lẫn khi socket đóng.
   */
  leave(session: GameSession): void {
    const characterId = session.characterId;
    const mapId = session.mapId;
    session.mapId = undefined;

    if (!characterId) {
      return;
    }

    this.options.chat.forget(characterId);
    this.options.sessions.release(characterId, session);

    if (!mapId) {
      return;
    }
    const room = this.options.rooms.get(mapId);
    const player = room?.removePlayer(characterId);
    if (room && player) {
      room.broadcast(Opcode.S2C_ENTITY_REMOVE, { id: player.id });
      this.options.rooms.dropIfEmpty(room);
    }
  }

  private helloPayload(character: Character, mapId: string): ServerHello {
    return {
      protocolVersion: PROTOCOL_VERSION,
      tickRateMs: TICK_RATE_MS,
      characterId: character.id,
      characterName: character.name,
      mapId,
      serverTime: this.now(),
    };
  }

  /**
   * Chuyển một người chơi sang bản đồ mà cổng dẫn tới — **đường chuyển map duy nhất**, dùng chung
   * cho cả hai lối vào (client xin bằng `C2S_ENTER_MAP` và server tự phát hiện lúc đi bộ).
   */
  private transfer(room: Room, player: RoomPlayer, portal: MapPortal, session: GameSession): void {
    const target = this.options.rooms.getOrCreate(portal.toMap);
    const spawn = target?.map.spawnPosition(portal.toSpawn) ?? target?.map.defaultSpawn();
    if (!target || !spawn) {
      session.sendError(ErrorCode.UNKNOWN_MAP, `không vào được bản đồ "${portal.toMap}"`);
      return;
    }

    room.removePlayer(player.id);
    room.broadcast(Opcode.S2C_ENTITY_REMOVE, { id: player.id });
    this.options.rooms.dropIfEmpty(room);

    player.x = spawn.x;
    player.y = spawn.y;
    player.target = undefined;
    player.facing = 'none';
    target.addPlayer(player);
    session.mapId = target.map.id;

    this.sendEnterMap(session, target, player);
    target.broadcast(Opcode.S2C_ENTITY_ADD, { entity: playerView(player) }, player.id);
  }

  private sendEnterMap(session: GameSession, room: Room, player: RoomPlayer): void {
    const payload: ServerEnterMap = {
      map: room.map.toSnapshot(),
      entity: playerView(player),
      // Người vừa vào không nhận chính mình trong danh sách thực thể.
      entities: room.entityViews(player.id),
      chatBacklog: room.chatBacklog(),
    };
    session.send(Opcode.S2C_ENTER_MAP, payload);
  }

  /** Một nhân vật chỉ có một kết nối: phiên cũ bị dọn khỏi room rồi bị đóng. */
  private evictPreviousSessions(session: GameSession, characterId: string): void {
    const previous = this.options.sessions.register(characterId, session);
    if (!previous || previous === session) {
      return;
    }
    this.leave(previous);
    previous.replacedByNewLogin();
  }

  private locate(session: GameSession): { room: Room; player: RoomPlayer } | undefined {
    if (!session.characterId || !session.mapId) {
      return undefined;
    }
    const room = this.options.rooms.get(session.mapId);
    const player = room?.getPlayer(session.characterId);
    return room && player ? { room, player } : undefined;
  }

  private rejectNotInWorld(session: GameSession): void {
    session.sendError(ErrorCode.INTERNAL, 'bạn chưa vào bản đồ nào, hãy bắt tay lại');
  }
}

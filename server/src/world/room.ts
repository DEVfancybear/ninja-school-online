import {
  CHAT_BACKLOG_SIZE,
  Opcode,
  type Character,
  type ChatMessage,
  type Entity,
  type EntityMove,
  type Npc,
  type ServerEnterMap,
} from '@ninja/shared';
import { playerColor } from './entity-color.js';
import type { MapInstance, Position } from './map.js';
import { facingFor, roundPosition, stepTowards, type Facing } from './movement.js';

/** Kênh gửi gói tin ra ngoài của một người chơi trong room (tầng `net/` cài đặt). */
export interface RoomChannel {
  send(op: number, payload: unknown): void;
}

/** Một người chơi đang ở trong room; vị trí do server quyết định. */
export interface RoomPlayer {
  /** Id thực thể gửi cho client — dùng id nhân vật nên ổn định khi đổi map. */
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly level: number;
  readonly school: Character['school'];
  readonly class: Character['class'];
  readonly channel: RoomChannel;
  x: number;
  y: number;
  facing: Facing;
  /** Đích đang đi tới; `undefined` là đang đứng yên. */
  target: Position | undefined;
}

/** Một NPC đặt sẵn trên bản đồ. */
export interface RoomNpc {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  /** Hội thoại nạp từ `game-data/npcs/`. */
  readonly data: Npc;
}

/** Tạo thực thể người chơi từ nhân vật trong database. */
export function createPlayer(options: {
  character: Character;
  position: Position;
  channel: RoomChannel;
}): RoomPlayer {
  const { character, position, channel } = options;
  return {
    id: character.id,
    name: character.name,
    color: playerColor(character.school),
    level: character.level,
    school: character.school,
    class: character.class,
    channel,
    x: position.x,
    y: position.y,
    facing: 'none',
    target: undefined,
  };
}

/** Dạng gửi cho client của một người chơi. */
export function playerView(player: RoomPlayer): Entity {
  return {
    id: player.id,
    kind: 'player',
    name: player.name,
    color: player.color,
    x: roundPosition(player.x),
    y: roundPosition(player.y),
    level: player.level,
    school: player.school,
    class: player.class,
  };
}

/** Dạng gửi cho client của một NPC. */
export function npcView(npc: RoomNpc): Entity {
  return { id: npc.id, kind: 'npc', name: npc.name, color: npc.color, x: npc.x, y: npc.y };
}

/**
 * Room = một bản đồ (M2 chưa chia kênh). Giữ người chơi đang ở trong, NPC đặt sẵn, lịch sử chat
 * gần nhất và đẩy người chơi đi theo từng nhịp tick.
 */
export class Room {
  private readonly playersById = new Map<string, RoomPlayer>();
  private readonly npcsById = new Map<string, RoomNpc>();
  private readonly backlog: ServerEnterMap['chatBacklog'] = [];

  constructor(
    readonly map: MapInstance,
    npcs: ReadonlyMap<string, Npc>,
  ) {
    for (const placement of map.data.npcs) {
      const data = npcs.get(placement.id);
      if (!data) {
        // Không thể xảy ra: `loadGameData` đã kiểm NPC đặt trên map phải có file hội thoại.
        continue;
      }
      const position = map.tileCenter(placement.x, placement.y);
      this.npcsById.set(placement.id, {
        id: placement.id,
        name: data.name,
        color: data.color,
        x: position.x,
        y: position.y,
        data,
      });
    }
  }

  get playerCount(): number {
    return this.playersById.size;
  }

  players(): IterableIterator<RoomPlayer> {
    return this.playersById.values();
  }

  getPlayer(id: string): RoomPlayer | undefined {
    return this.playersById.get(id);
  }

  getNpc(id: string): RoomNpc | undefined {
    return this.npcsById.get(id);
  }

  addPlayer(player: RoomPlayer): void {
    this.playersById.set(player.id, player);
  }

  removePlayer(id: string): RoomPlayer | undefined {
    const player = this.playersById.get(id);
    if (player) {
      this.playersById.delete(id);
    }
    return player;
  }

  /** Toàn bộ thực thể đang thấy được trên map, có thể bỏ qua một id (chính người vừa vào). */
  entityViews(exceptId?: string): Entity[] {
    const views: Entity[] = [];
    for (const player of this.playersById.values()) {
      if (player.id !== exceptId) {
        views.push(playerView(player));
      }
    }
    for (const npc of this.npcsById.values()) {
      views.push(npcView(npc));
    }
    return views;
  }

  /** Tin chat gần nhất của room, gửi kèm khi có người vào map. */
  chatBacklog(): ServerEnterMap['chatBacklog'] {
    return [...this.backlog];
  }

  /** Gửi một gói tin cho mọi người trong room (trừ `exceptId` nếu có). */
  broadcast(op: number, payload: unknown, exceptId?: string): void {
    for (const player of this.playersById.values()) {
      if (player.id !== exceptId) {
        player.channel.send(op, payload);
      }
    }
  }

  /** Phát một tin chat cho cả room và ghi vào lịch sử gần nhất. */
  sendChat(message: ChatMessage): void {
    this.backlog.push({
      channel: message.channel,
      fromName: message.fromName,
      text: message.text,
      at: message.at,
    });
    if (this.backlog.length > CHAT_BACKLOG_SIZE) {
      this.backlog.splice(0, this.backlog.length - CHAT_BACKLOG_SIZE);
    }
    this.broadcast(Opcode.S2C_CHAT, message);
  }

  /**
   * Một nhịp tick: đẩy mọi người chơi đang di chuyển tiến thêm `MOVE_STEP_PX` về đích, rồi phát
   * **một** gói `S2C_ENTITY_MOVE` cho cả room với những thực thể đã đổi vị trí — kể cả người vừa
   * di chuyển, để client thấy vị trí mà server xác nhận.
   */
  tick(): void {
    const moves: EntityMove['moves'] = [];
    for (const player of this.playersById.values()) {
      const target = player.target;
      if (!target) {
        continue;
      }

      const step = stepTowards({ x: player.x, y: player.y }, target);
      const dx = step.x - player.x;
      const dy = step.y - player.y;
      if (dx === 0 && dy === 0) {
        player.target = undefined;
        continue;
      }

      player.x = step.x;
      player.y = step.y;
      player.facing = facingFor(dx, dy);
      if (step.arrived) {
        player.target = undefined;
      }
      moves.push({
        id: player.id,
        x: roundPosition(player.x),
        y: roundPosition(player.y),
        facing: player.facing,
      });
    }

    if (moves.length > 0) {
      this.broadcast(Opcode.S2C_ENTITY_MOVE, { moves });
    }
  }
}

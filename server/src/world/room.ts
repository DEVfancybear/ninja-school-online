import {
  CHAT_BACKLOG_SIZE,
  Opcode,
  type Character,
  type ChatMessage,
  type Entity,
  type EntityMove,
  type Monster,
  type MonsterShape,
  type Npc,
  type ServerEnterMap,
} from '@ninja/shared';
import { playerColor } from './entity-color.js';
import type { MapInstance, MapPortal, Position } from './map.js';
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

/**
 * Một người vừa bước vào vùng cổng dẫn sang bản đồ khác trong nhịp tick. Room chỉ **báo** việc này
 * lên (xem `Room.tick`); việc đổi room do `RoomManager` → `WorldService` làm.
 */
export interface PortalCrossing {
  readonly player: RoomPlayer;
  readonly portal: MapPortal;
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

/**
 * Một con quái đang ở trên bản đồ. Bản đồ đặt cùng một loại quái ở nhiều chỗ thì đây là **nhiều con
 * độc lập**: mỗi con có máu và thời điểm sống lại riêng.
 */
export interface RoomMonster {
  /** Id thực thể gửi cho client: `mob:<mapId>:<số thứ tự chỗ đặt>`. */
  readonly id: string;
  /** Id loại quái trong `game-data/monsters/`, ví dụ `mob-bui-nhon`. */
  readonly monsterId: string;
  readonly name: string;
  readonly color: string;
  readonly shape: MonsterShape;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly respawnMs: number;
  hp: number;
  alive: boolean;
  /** Thời điểm sống lại; `undefined` khi đang sống hoặc loại quái này không hồi sinh. */
  respawnAt: number | undefined;
}

/** Id thực thể của con quái thứ `index` trên bản đồ `mapId`. Ổn định giữa các lần vào game. */
export function monsterEntityId(mapId: string, index: number): string {
  return `mob:${mapId}:${index}`;
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
 * Dạng gửi cho client của một con quái. Gửi lại cùng id khi máu đổi hoặc khi sống lại: client thêm
 * hoặc **thay thế** theo id (xem `upsertEntity` phía client), nên thanh máu trên bản đồ luôn đúng.
 */
export function monsterView(monster: RoomMonster): Entity {
  return {
    id: monster.id,
    kind: 'monster',
    name: monster.name,
    color: monster.color,
    x: monster.x,
    y: monster.y,
    level: monster.level,
    hp: monster.hp,
    maxHp: monster.maxHp,
    shape: monster.shape,
  };
}

/**
 * Room = một bản đồ (M2 chưa chia kênh). Giữ người chơi đang ở trong, NPC đặt sẵn, lịch sử chat
 * gần nhất và đẩy người chơi đi theo từng nhịp tick.
 */
export class Room {
  private readonly playersById = new Map<string, RoomPlayer>();
  private readonly npcsById = new Map<string, RoomNpc>();
  private readonly monstersById = new Map<string, RoomMonster>();
  private readonly backlog: ServerEnterMap['chatBacklog'] = [];

  constructor(
    readonly map: MapInstance,
    npcs: ReadonlyMap<string, Npc>,
    monsters: ReadonlyMap<string, Monster>,
  ) {
    for (const [index, placement] of (map.data.monsters ?? []).entries()) {
      const data = monsters.get(placement.id);
      if (!data) {
        // Không thể xảy ra: `checkGameData` kiểm quái đặt trên map phải có file dữ liệu.
        continue;
      }
      const position = map.tileCenter(placement.x, placement.y);
      this.monstersById.set(monsterEntityId(map.id, index), {
        id: monsterEntityId(map.id, index),
        monsterId: data.id,
        name: data.name,
        color: data.color,
        shape: data.shape,
        level: data.level,
        x: position.x,
        y: position.y,
        maxHp: data.maxHp,
        attack: data.attack,
        defense: data.defense,
        speed: data.speed,
        respawnMs: data.respawnMs,
        hp: data.maxHp,
        alive: true,
        respawnAt: undefined,
      });
    }
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

  /** Mọi con quái của bản đồ, kể cả con đang chết chờ sống lại. */
  monsters(): RoomMonster[] {
    return [...this.monstersById.values()];
  }

  /**
   * Cập nhật máu của một con quái (trận đấu gọi khi đánh trúng). Về 0 thì con quái chết và hẹn giờ
   * sống lại; mọi thay đổi đều phát lại thực thể để client vẽ đúng thanh máu trên bản đồ.
   */
  setMonsterHp(id: string, hp: number, now: number): void {
    const monster = this.monstersById.get(id);
    if (!monster) {
      return;
    }
    monster.hp = Math.max(0, Math.min(monster.maxHp, Math.round(hp)));
    if (monster.hp === 0 && monster.alive) {
      monster.alive = false;
      monster.respawnAt = monster.respawnMs > 0 ? now + monster.respawnMs : undefined;
    }
    this.broadcast(Opcode.S2C_ENTITY_ADD, { entity: monsterView(monster) });
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
    for (const monster of this.monstersById.values()) {
      views.push(monsterView(monster));
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
   *
   * Trả về những người vừa **bước vào vùng cổng** dẫn sang bản đồ khác. Room không tự chuyển map
   * (nó không biết các room khác) và cũng không tự xoá người chơi: `RoomManager` nhận danh sách
   * này rồi nhờ `WorldService` đổi room, đúng một đường chuyển map duy nhất.
   */
  tick(now: number): PortalCrossing[] {
    const moves: EntityMove['moves'] = [];
    const crossings: PortalCrossing[] = [];
    this.respawnMonsters(now);
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

      // Cổng chỉ kích hoạt khi **bước vào** vùng cổng của bản đồ khác: đứng yên trong vùng cổng
      // (hoặc cổng dẫn về chính bản đồ này) thì không có gì xảy ra.
      const portal = this.map.portalAt(player.x, player.y);
      if (portal && portal.toMap !== this.map.id) {
        crossings.push({ player, portal });
      }
    }

    if (moves.length > 0) {
      this.broadcast(Opcode.S2C_ENTITY_MOVE, { moves });
    }

    // Chuyển map sau khi đã phát gói di chuyển: người đi vẫn nhận được vị trí cuối ở map cũ.
    return crossings;
  }

  /** Quái hết thời gian chờ thì sống lại đầy máu và hiện ra với mọi người trong bản đồ. */
  private respawnMonsters(now: number): void {
    for (const monster of this.monstersById.values()) {
      if (monster.alive || monster.respawnAt === undefined || now < monster.respawnAt) {
        continue;
      }
      monster.alive = true;
      monster.respawnAt = undefined;
      monster.hp = monster.maxHp;
      this.broadcast(Opcode.S2C_ENTITY_ADD, { entity: monsterView(monster) });
    }
  }
}

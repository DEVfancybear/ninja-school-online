import type { GameData } from '../world/game-data.js';
import { MapInstance, type MapPortal } from '../world/map.js';
import { Room, type RoomPlayer } from '../world/room.js';
import type { TickScheduler } from './tick.js';

export interface RoomManagerOptions {
  gameData: GameData;
  tick: TickScheduler;
  /** Đồng hồ dùng để hẹn giờ quái sống lại; kiểm thử truyền đồng hồ giả. */
  now?: () => number;
  /** Báo lỗi khi một room hỏng trong nhịp tick — một room lỗi không được làm chết cả server. */
  onError?: (error: unknown, mapId: string) => void;
  /**
   * Có người vừa bước vào vùng cổng dẫn sang bản đồ khác. RoomManager không tự chuyển map (nó
   * không giữ phiên kết nối); nó chuyển việc này cho tầng thế giới.
   */
  onPortal?: (room: Room, player: RoomPlayer, portal: MapPortal) => void;
}

/**
 * Quản lý room theo bản đồ: room được tạo khi có người đầu tiên vào và xoá khi không còn ai.
 * RoomManager cũng là nơi duy nhất gọi `Room.tick()` theo nhịp dùng chung.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly maps = new Map<string, MapInstance>();
  private readonly unsubscribe: () => void;

  constructor(private readonly options: RoomManagerOptions) {
    this.unsubscribe = options.tick.onTick(() => {
      this.tickAll();
    });
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get(mapId: string): Room | undefined {
    return this.rooms.get(mapId);
  }

  /** Room của một bản đồ; chưa có thì tạo. Trả `undefined` nếu game-data không có bản đồ đó. */
  getOrCreate(mapId: string): Room | undefined {
    const existing = this.rooms.get(mapId);
    if (existing) {
      return existing;
    }
    const map = this.mapFor(mapId);
    if (!map) {
      return undefined;
    }
    const room = new Room(map, this.options.gameData.npcs, this.options.gameData.monsters);
    this.rooms.set(mapId, room);
    return room;
  }

  /** Xoá room khi đã không còn người chơi (lịch sử chat của room đó cũng mất theo). */
  dropIfEmpty(room: Room): void {
    if (room.playerCount === 0 && this.rooms.get(room.map.id) === room) {
      this.rooms.delete(room.map.id);
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.rooms.clear();
  }

  private mapFor(mapId: string): MapInstance | undefined {
    const cached = this.maps.get(mapId);
    if (cached) {
      return cached;
    }
    const data = this.options.gameData.maps.get(mapId);
    if (!data) {
      return undefined;
    }
    const map = new MapInstance(data);
    this.maps.set(mapId, map);
    return map;
  }

  private tickAll(): void {
    for (const room of [...this.rooms.values()]) {
      try {
        // Một room có thể bị xoá trong lúc xử lý cổng (người cuối cùng vừa đi khỏi), nên duyệt
        // trên bản sao danh sách room.
        for (const crossing of room.tick((this.options.now ?? Date.now)())) {
          this.options.onPortal?.(room, crossing.player, crossing.portal);
        }
      } catch (error) {
        this.options.onError?.(error, room.map.id);
      }
    }
  }
}

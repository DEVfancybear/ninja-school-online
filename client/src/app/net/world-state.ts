import { Injectable, computed, signal } from '@angular/core';
import {
  Opcode,
  TICK_RATE_MS,
  type CharacterStats,
  type ChatChannel,
  type ChatMessage,
  type EntityAdd,
  type EntityMove,
  type EntityRemove,
  type InventoryItem,
  type InventoryUpdate,
  type LevelUp,
  type NpcDialog,
  type ServerEnterMap,
} from '@ninja/shared';
import {
  applyEntityMoves,
  removeEntity,
  upsertEntity,
  worldEntityFrom,
  type WorldEntity,
} from './world-types';

/**
 * Một dòng trong khung chat. Tin trong `chatBacklog` của `S2C_ENTER_MAP` không có `fromId`
 * (hợp đồng chỉ gửi tên người gửi), nên trường này là tuỳ chọn và giao diện phải chịu được
 * việc không biết ai là người gửi.
 */
export interface ChatLine {
  readonly channel: ChatChannel;
  readonly fromName: string;
  readonly text: string;
  readonly at: number;
  readonly fromId?: string;
}

/** Số dòng chat giữ trong bộ nhớ; nhiều hơn `CHAT_BACKLOG_SIZE` để cuộn lại vẫn thấy. */
export const CHAT_LOG_LIMIT = 100;

/**
 * Trạng thái thế giới mà client nhìn thấy, giữ bằng signals.
 *
 * Service chỉ tiêu thụ gói tin **đã** được `GameSocket` kiểm bằng `decodeServerPacket`, nên
 * ở đây chỉ cần ép kiểu theo `op` (tra bảng trong `shared/src/protocol/packets.ts`) — không
 * kiểm lại lần hai để khỏi tốn công trên mỗi khung hình.
 */
@Injectable({ providedIn: 'root' })
export class WorldState {
  private readonly mapSignal = signal<ServerEnterMap['map'] | null>(null);
  private readonly entitiesSignal = signal<readonly WorldEntity[]>([]);
  private readonly selfIdSignal = signal<string | null>(null);
  private readonly chatSignal = signal<readonly ChatLine[]>([]);
  private readonly dialogSignal = signal<NpcDialog | null>(null);
  private readonly tickRateSignal = signal(TICK_RATE_MS);
  private readonly characterSignal = signal<CharacterStats | null>(null);
  private readonly inventorySignal = signal<readonly InventoryItem[]>([]);
  private readonly inventoryCapacitySignal = signal(0);
  private readonly levelUpSignal = signal<LevelUp | null>(null);

  readonly map = this.mapSignal.asReadonly();
  readonly entities = this.entitiesSignal.asReadonly();
  readonly selfId = this.selfIdSignal.asReadonly();
  readonly chat = this.chatSignal.asReadonly();
  readonly npcDialog = this.dialogSignal.asReadonly();
  /** Chỉ số nhân vật của mình: HUD vẽ máu/nội lực/kinh nghiệm, bảng trận đấu lấy danh sách chiêu. */
  readonly character = this.characterSignal.asReadonly();
  readonly inventory = this.inventorySignal.asReadonly();
  readonly inventoryCapacity = this.inventoryCapacitySignal.asReadonly();
  /**
   * Lần lên cấp gần nhất, để trang `/play` báo cho người chơi biết vừa học được chiêu gì.
   * Trang gọi `clearLevelUp()` sau khi báo xong.
   */
  readonly lastLevelUp = this.levelUpSignal.asReadonly();
  /** Nhịp tick server báo trong `S2C_HELLO`; dùng để nội suy chuyển động. */
  readonly tickRateMs = this.tickRateSignal.asReadonly();

  /** Nhân vật của chính mình, `null` khi chưa vào map. */
  readonly self = computed<WorldEntity | null>(() => {
    const id = this.selfIdSignal();
    return id === null ? null : (this.entitiesSignal().find((entity) => entity.id === id) ?? null);
  });

  /** Tên bản đồ đang ở, dùng cho HUD. */
  readonly mapName = computed(() => this.mapSignal()?.name ?? '');

  setTickRate(tickRateMs: number): void {
    if (tickRateMs > 0) {
      this.tickRateSignal.set(tickRateMs);
    }
  }

  /** Áp một gói server gửi xuống; trả về `false` nếu gói không thuộc phần thế giới. */
  applyPacket(op: number, payload: unknown): boolean {
    switch (op) {
      case Opcode.S2C_ENTER_MAP:
        this.applyEnterMap(payload as ServerEnterMap);
        return true;
      case Opcode.S2C_ENTITY_ADD:
        this.entitiesSignal.update((entities) =>
          upsertEntity(entities, worldEntityFrom((payload as EntityAdd).entity)),
        );
        return true;
      case Opcode.S2C_ENTITY_REMOVE:
        this.entitiesSignal.update((entities) =>
          removeEntity(entities, (payload as EntityRemove).id),
        );
        return true;
      case Opcode.S2C_ENTITY_MOVE:
        this.entitiesSignal.update((entities) =>
          applyEntityMoves(entities, (payload as EntityMove).moves),
        );
        return true;
      case Opcode.S2C_CHAT:
        this.pushChat(toChatLine(payload as ChatMessage));
        return true;
      case Opcode.S2C_NPC_DIALOG:
        this.dialogSignal.set(payload as NpcDialog);
        return true;
      case Opcode.S2C_CHARACTER:
        this.characterSignal.set(payload as CharacterStats);
        return true;
      case Opcode.S2C_LEVEL_UP: {
        const levelUp = payload as LevelUp;
        // `S2C_LEVEL_UP` mang theo chỉ số mới, nên không cần chờ `S2C_CHARACTER` riêng.
        this.characterSignal.set(levelUp.character);
        this.levelUpSignal.set(levelUp);
        return true;
      }
      case Opcode.S2C_INVENTORY_UPDATE: {
        const bag = payload as InventoryUpdate;
        this.inventorySignal.set(bag.items);
        this.inventoryCapacitySignal.set(bag.capacity);
        return true;
      }
      default:
        return false;
    }
  }

  /** Xoá sạch thế giới: gọi khi mất kết nối để không hiện dữ liệu cũ của lần chơi trước. */
  reset(): void {
    this.mapSignal.set(null);
    this.entitiesSignal.set([]);
    this.selfIdSignal.set(null);
    this.chatSignal.set([]);
    this.dialogSignal.set(null);
    this.characterSignal.set(null);
    this.inventorySignal.set([]);
    this.inventoryCapacitySignal.set(0);
    this.levelUpSignal.set(null);
  }

  closeDialog(): void {
    this.dialogSignal.set(null);
  }

  /** Báo xong lần lên cấp vừa rồi; nếu không xoá thì thông báo sẽ hiện lại mỗi lần vẽ lại. */
  clearLevelUp(): void {
    this.levelUpSignal.set(null);
  }

  private applyEnterMap(data: ServerEnterMap): void {
    const others = data.entities.map((entity) => worldEntityFrom(entity));
    const hasSelf = others.some((entity) => entity.id === data.entity.id);
    this.mapSignal.set(data.map);
    this.selfIdSignal.set(data.entity.id);
    this.entitiesSignal.set(hasSelf ? others : [worldEntityFrom(data.entity), ...others]);
    this.chatSignal.set(data.chatBacklog.map(toChatLine).slice(-CHAT_LOG_LIMIT));
    this.dialogSignal.set(null);
  }

  private pushChat(line: ChatLine): void {
    this.chatSignal.update((lines) => [...lines, line].slice(-CHAT_LOG_LIMIT));
  }
}

function toChatLine(message: ChatMessage | ServerEnterMap['chatBacklog'][number]): ChatLine {
  return {
    channel: message.channel,
    fromName: message.fromName,
    text: message.text,
    at: message.at,
    ...('fromId' in message ? { fromId: message.fromId } : {}),
  };
}

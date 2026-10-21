import { Injectable, computed, signal } from '@angular/core';
import { PARTY_MAX_MEMBERS, Opcode, type PartyUpdate, type SocialPerson } from '@ninja/shared';

/** Một lời mời vào đội mà người chơi đang nhận được. */
export type PartyInviteView = PartyUpdate['invites'][number];

/**
 * Trạng thái tổ đội rỗng: không ở đội nào, không có lời mời nào.
 *
 * Bảng tổ đội vẽ được ngay từ lúc mới vào game nên client tự dựng sẵn; trần `PARTY_MAX_MEMBERS`
 * lấy từ `@ninja/shared` thay vì đặt lại con số của luật.
 */
export function emptyPartyState(): PartyUpdate {
  return {
    partyId: null,
    leaderName: null,
    members: [],
    invites: [],
    maxMembers: PARTY_MAX_MEMBERS,
  };
}

/**
 * Tổ đội ở phía client: đội hiện tại, đội trưởng, thành viên và lời mời đang chờ.
 *
 * `S2C_PARTY_UPDATE` mang **toàn bộ** trạng thái của chính người nhận nên service thay cả cục.
 * Không có đội thì `partyId`/`leaderName` là `null` mà `invites` vẫn có thể còn lời mời — vì vậy
 * "có đội" phải xét `partyId`, đừng suy từ danh sách thành viên.
 */
@Injectable({ providedIn: 'root' })
export class PartyState {
  private readonly partySignal = signal<PartyUpdate>(emptyPartyState());

  /** Toàn bộ trạng thái đội gần nhất — bảng xã hội nhận đúng một đầu vào này. */
  readonly snapshot = this.partySignal.asReadonly();

  readonly partyId = computed(() => this.partySignal().partyId);
  readonly leaderName = computed(() => this.partySignal().leaderName);
  readonly members = computed<readonly SocialPerson[]>(() => this.partySignal().members);
  readonly invites = computed<readonly PartyInviteView[]>(() => this.partySignal().invites);
  readonly maxMembers = computed(() => this.partySignal().maxMembers);

  /** Đang ở trong một đội nào đó (kể cả khi chỉ còn một mình sau khi người khác rời). */
  readonly inParty = computed(() => this.partySignal().partyId !== null);

  /**
   * Người chơi có phải đội trưởng không.
   *
   * Hợp đồng không gửi id của mình trong gói đội, nên nơi gọi truyền tên nhân vật đang chơi
   * (`selfName`) — nhờ vậy chỉ một chỗ duy nhất quyết định chuyện "ai được đuổi người".
   */
  isLeader(selfName: string | null): boolean {
    const leader = this.partySignal().leaderName;
    return leader !== null && selfName !== null && leader === selfName;
  }

  /** Áp một gói server gửi xuống; trả về `false` nếu gói không thuộc phần tổ đội. */
  applyPacket(op: number, payload: unknown): boolean {
    if (op !== Opcode.S2C_PARTY_UPDATE) {
      return false;
    }
    this.partySignal.set(payload as PartyUpdate);
    return true;
  }

  /** Mất kết nối hoặc rời trang: bỏ trạng thái đội của lần chơi trước. */
  reset(): void {
    this.partySignal.set(emptyPartyState());
  }
}

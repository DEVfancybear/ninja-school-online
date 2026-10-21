import { Injectable, computed, signal } from '@angular/core';
import { MAX_FRIENDS, Opcode, type SocialPerson, type SocialUpdate } from '@ninja/shared';

/**
 * Trạng thái xã hội rỗng: chưa có bạn, chưa có lời mời nào.
 *
 * Bảng xã hội luôn vẽ được ngay từ lúc mới vào game (trước `S2C_SOCIAL_UPDATE` đầu tiên), nên
 * client tự dựng sẵn thay vì để giao diện phải chịu `null`. Trần `MAX_FRIENDS` lấy từ
 * `@ninja/shared` — client không tự đặt lại con số của luật.
 */
export function emptySocialState(): SocialUpdate {
  return { friends: [], incoming: [], outgoing: [], maxFriends: MAX_FRIENDS };
}

/**
 * Bạn bè và lời mời kết bạn ở phía client.
 *
 * `S2C_SOCIAL_UPDATE` mang **toàn bộ** danh sách (bạn bè, lời mời nhận được, lời mời đã gửi) nên
 * service chỉ thay cả cục, không cộng dồn từng người. Cùng cách làm với `WorldState` và trạng thái
 * nhiệm vụ: server quyết định, client chỉ giữ bản mới nhất.
 */
@Injectable({ providedIn: 'root' })
export class SocialState {
  private readonly socialSignal = signal<SocialUpdate>(emptySocialState());

  readonly friends = computed<readonly SocialPerson[]>(() => this.socialSignal().friends);
  readonly incoming = computed<readonly SocialPerson[]>(() => this.socialSignal().incoming);
  readonly outgoing = computed<readonly SocialPerson[]>(() => this.socialSignal().outgoing);
  readonly maxFriends = computed(() => this.socialSignal().maxFriends);

  /**
   * Số lời mời đang chờ **nhận**: huy hiệu trên nút HUD cần con số này để nhắc người chơi mở bảng.
   *
   * Lời mời đội nằm ở `PartyState`; trang `/play` cộng hai con số lại vì huy hiệu là chuyện của
   * giao diện, không phải của riêng service nào.
   */
  readonly incomingCount = computed(() => this.socialSignal().incoming.length);

  /** Áp một gói server gửi xuống; trả về `false` nếu gói không thuộc phần xã hội. */
  applyPacket(op: number, payload: unknown): boolean {
    if (op !== Opcode.S2C_SOCIAL_UPDATE) {
      return false;
    }
    this.socialSignal.set(payload as SocialUpdate);
    return true;
  }

  /** Mất kết nối hoặc rời trang: bỏ danh sách của lần chơi trước. */
  reset(): void {
    this.socialSignal.set(emptySocialState());
  }
}

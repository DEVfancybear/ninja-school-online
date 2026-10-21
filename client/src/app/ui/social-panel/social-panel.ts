import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PartyUpdate, SocialPerson } from '@ninja/shared';

/** Hai thẻ của bảng xã hội: danh sách bạn và tổ đội. */
export type SocialTab = 'friends' | 'party';

/** Một lời mời vào đội, đúng hình dạng gói dùng chung khai trong `PartyUpdateSchema`. */
export type PartyInviteView = PartyUpdate['invites'][number];

/** Trần ký tự của ô nhập tên — khớp `PersonNameSchema` của gói dùng chung. */
export const SOCIAL_NAME_MAX_LENGTH = 24;

/**
 * Bảng xã hội: một chỗ cho bạn bè và tổ đội.
 *
 * Component **không** gửi gói tin — nó chỉ phát ra ý định của người chơi (kết bạn, nhận lời, đuổi
 * người…), còn trang `/play` mới là nơi dựng gói. Nhờ vậy cùng một chỗ vẽ được cả lời mời kết bạn
 * lẫn lời mời vào đội, và người chơi không phải mở hai bảng cùng lúc.
 */
@Component({
  selector: 'app-social-panel',
  imports: [FormsModule],
  templateUrl: './social-panel.html',
  styleUrl: './social-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialPanel {
  readonly friends = input<readonly SocialPerson[]>([]);
  readonly incoming = input<readonly SocialPerson[]>([]);
  readonly outgoing = input<readonly SocialPerson[]>([]);
  readonly maxFriends = input(0);

  /** Trạng thái tổ đội gần nhất; `null` khi chưa nhận được `S2C_PARTY_UPDATE` nào. */
  readonly party = input<PartyUpdate | null>(null);
  /** Tên nhân vật đang chơi — dùng để biết mình có phải đội trưởng, và để không đuổi chính mình. */
  readonly selfName = input('');

  readonly closed = output<void>();

  readonly friendRequest = output<string>();
  readonly friendAccept = output<string>();
  readonly friendDecline = output<string>();
  readonly friendRemove = output<string>();

  readonly partyInvite = output<string>();
  readonly partyAccept = output<string>();
  readonly partyDecline = output<string>();
  readonly partyLeave = output<void>();
  readonly partyKick = output<string>();

  readonly tab = signal<SocialTab>('friends');
  readonly friendDraft = signal('');
  readonly partyDraft = signal('');
  readonly nameMaxLength = SOCIAL_NAME_MAX_LENGTH;

  readonly members = computed<readonly SocialPerson[]>(() => this.party()?.members ?? []);
  readonly invites = computed<readonly PartyInviteView[]>(() => this.party()?.invites ?? []);
  readonly inParty = computed(() => (this.party()?.partyId ?? null) !== null);
  readonly maxMembers = computed(() => this.party()?.maxMembers ?? 0);

  /** Đội trưởng là người duy nhất thấy nút đuổi thành viên. */
  readonly isLeader = computed(() => {
    const leader = this.party()?.leaderName ?? null;
    const selfName = this.selfName();
    return leader !== null && selfName.length > 0 && leader === selfName;
  });

  showTab(tab: SocialTab): void {
    this.tab.set(tab);
  }

  onFriendDraft(event: Event): void {
    this.friendDraft.set(readValue(event).slice(0, this.nameMaxLength));
  }

  onPartyDraft(event: Event): void {
    this.partyDraft.set(readValue(event).slice(0, this.nameMaxLength));
  }

  submitFriend(): void {
    const name = this.friendDraft().trim();
    if (name.length === 0) {
      return;
    }
    this.friendRequest.emit(name);
    this.friendDraft.set('');
  }

  submitParty(): void {
    const name = this.partyDraft().trim();
    if (name.length === 0) {
      return;
    }
    this.partyInvite.emit(name);
    this.partyDraft.set('');
  }

  /** Chỉ đuổi được người khác: đội trưởng đuổi chính mình là chuyện server đã có mã lỗi riêng. */
  canKick(name: string): boolean {
    return this.isLeader() && name !== this.selfName();
  }
}

/** Đọc giá trị ô nhập từ sự kiện `input` (không dùng `ngModel` để giữ đúng một chiều dữ liệu). */
function readValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

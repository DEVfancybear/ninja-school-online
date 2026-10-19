import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { NpcDialog, QuestView } from '@ninja/shared';
import { questObjectiveText, questRewardText } from '../../core/game-labels';

/** Một lựa chọn trong cây hội thoại của nhánh đang mở; `next` là nhánh sẽ mở khi bấm. */
export type NpcDialogOption = NpcDialog['options'][number];

/** Một khối nhiệm vụ làm được tại NPC, chữ đã soạn sẵn cho giao diện. */
interface QuestCard {
  readonly quest: QuestView;
  readonly objectives: readonly string[];
  /** Phần thưởng dạng "150 kinh nghiệm · 180 yên"; rỗng khi nhiệm vụ không thưởng gì. */
  readonly rewards: string;
}

/**
 * Panel hội thoại NPC: tên NPC, từng dòng nói, các lựa chọn của nhánh đang mở, nhiệm vụ làm được
 * tại NPC này và nút đóng.
 *
 * Component **không** gửi gói tin nào: mỗi lựa chọn hay nút nhận/trả chỉ phát sự kiện ra ngoài, còn
 * trang `/play` mới là nơi gửi `C2S_NPC_TALK` / `C2S_QUEST_ACCEPT` / `C2S_QUEST_COMPLETE` — cùng
 * cách làm với túi đồ và quầy hàng.
 */
@Component({
  selector: 'app-npc-dialog',
  templateUrl: './npc-dialog.html',
  styleUrl: './npc-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NpcDialogPanel {
  readonly dialog = input.required<NpcDialog>();
  /** `close` là tên sự kiện DOM sẵn có nên output phải đặt tên khác. */
  readonly closed = output<void>();
  /** Người chơi bấm một lựa chọn trong cây hội thoại. */
  readonly optionChosen = output<NpcDialogOption>();
  /** Người chơi bấm "Nhận nhiệm vụ" ở một khối nhiệm vụ đang nhận được. */
  readonly accept = output<string>();
  /** Người chơi bấm "Trả nhiệm vụ" ở một khối nhiệm vụ đã xong mục tiêu. */
  readonly complete = output<string>();

  readonly quests = computed<readonly QuestCard[]>(() =>
    this.dialog().quests.map((quest) => ({
      quest,
      objectives: quest.objectives.map(questObjectiveText),
      rewards: questRewardText(quest.rewards),
    })),
  );

  /**
   * Bấm một lựa chọn: phát sự kiện cho trang `/play` gửi `optionId` đi, rồi đóng hộp thoại nếu
   * `next` là `null` — hợp đồng quy định đó là **kết thúc** hội thoại, nên để hộp thoại nằm lại
   * chỉ làm người chơi tưởng còn bấm được tiếp. Phát sự kiện trước để gói tin đi ngay cả khi
   * component bị gỡ khỏi giao diện.
   */
  onOption(option: NpcDialogOption): void {
    this.optionChosen.emit(option);
    if (option.next === null) {
      this.closed.emit();
    }
  }
}

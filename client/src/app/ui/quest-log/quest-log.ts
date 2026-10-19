import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { questFeatureLabel, type QuestUpdate, type QuestView } from '@ninja/shared';
import { questObjectiveText } from '../../core/game-labels';

/** Một nhiệm vụ đang làm, chữ đã soạn sẵn cho nhật ký. */
interface QuestRow {
  readonly questId: string;
  readonly name: string;
  /** Từng mục tiêu, dạng "Đánh hạ 2 Bù Nhìn Tập Luyện (1/2)". */
  readonly objectives: readonly string[];
  /** Xong hết mục tiêu thì nhật ký chỉ luôn chỗ trả nhiệm vụ. */
  readonly ready: boolean;
  readonly turnInName: string;
}

/** Một dòng của mục "Có thể nhận", dạng "Chào làng — gặp Thầy Hiệu Trưởng". */
interface AvailableRow {
  readonly questId: string;
  readonly text: string;
}

/**
 * Nhật ký nhiệm vụ: nhiệm vụ đang làm kèm tiến độ, danh sách nhiệm vụ đủ điều kiện nhận, số nhiệm
 * vụ đã trả và các tính năng đã mở khóa.
 *
 * Component chỉ **vẽ** trạng thái do server gửi (`S2C_QUEST_UPDATE`) và phát ra ý định đóng; trang
 * `/play` mới là nơi giữ trạng thái mở/đóng — cùng cách làm với túi đồ và bảng trang bị.
 */
@Component({
  selector: 'app-quest-log',
  templateUrl: './quest-log.html',
  styleUrl: './quest-log.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestLog {
  /** Trạng thái nhiệm vụ của nhân vật; trang `/play` truyền thẳng gói `S2C_QUEST_UPDATE`. */
  readonly quests = input.required<QuestUpdate>();

  readonly closed = output<void>();

  readonly active = computed<readonly QuestRow[]>(() =>
    this.quests().active.map((quest) => ({
      questId: quest.questId,
      name: quest.name,
      objectives: quest.objectives.map(questObjectiveText),
      ready: isReady(quest),
      turnInName: quest.turnInName,
    })),
  );

  readonly available = computed<readonly AvailableRow[]>(() =>
    this.quests().available.map((quest) => ({
      questId: quest.questId,
      text: `${quest.name} — gặp ${quest.giverName}`,
    })),
  );

  readonly completedCount = computed(() => this.quests().completed.length);
  readonly activeCount = computed(() => this.quests().active.length);
  readonly maxActive = computed(() => this.quests().maxActive);

  /** Cờ mở khóa hiện bằng nhãn tiếng Việt của `@ninja/shared`, không tự đặt tên riêng ở client. */
  readonly features = computed(() => this.quests().unlockedFeatures.map(questFeatureLabel));
}

/**
 * Nhiệm vụ đã xong mục tiêu, chờ trả.
 *
 * `state` là `ready` khi server đã suy ra như vậy; client vẫn xét cả tiến độ từng mục tiêu để nhật
 * ký không nói "chưa xong" trong khi mọi mục tiêu đều đã đạt (dữ liệu lệch nhau thì hiện cái đúng
 * với người chơi hơn).
 */
function isReady(quest: QuestView): boolean {
  return quest.state === 'ready' || quest.objectives.every((objective) => objective.done);
}

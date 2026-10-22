import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEVEL_MAX, type CharacterStats } from '@ninja/shared';
import { CONNECTION_LABELS, type ConnectionStatus } from '../../net/game-socket';

/** Thanh thông tin trên cùng khi chơi: nhân vật, chỉ số, bản đồ, độ trễ, trạng thái kết nối. */
@Component({
  selector: 'app-hud',
  imports: [RouterLink],
  templateUrl: './hud.html',
  styleUrl: './hud.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Hud {
  readonly characterName = input('');
  readonly mapName = input('');
  readonly latencyMs = input<number | null>(null);
  readonly status = input<ConnectionStatus>('closed');
  readonly chatVisible = input(true);
  /** Chỉ số nhân vật; `null` khi chưa nhận được gói `S2C_CHARACTER` (lúc mới vào game). */
  readonly character = input<CharacterStats | null>(null);
  readonly bagCount = input(0);
  readonly bagOpen = input(false);
  readonly equipmentOpen = input(false);
  readonly questOpen = input(false);
  /** Ba bảng của M6 mở hay đóng, để nút HUD sáng lên như các nút đang có. */
  readonly socialOpen = input(false);
  readonly guildOpen = input(false);
  readonly arenaOpen = input(false);
  readonly mailOpen = input(false);
  readonly m7Open = input(false);
  /** Số lời mời đang chờ (kết bạn + vào đội) — hiện thành huy hiệu trên nút Xã hội. */
  readonly socialBadge = input(0);
  /** Số thư chưa nhận quà — hiện thành huy hiệu trên nút Thư. */
  readonly mailBadge = input(0);

  readonly toggleChat = output<void>();
  readonly toggleInventory = output<void>();
  readonly toggleEquipment = output<void>();
  readonly toggleQuest = output<void>();
  readonly toggleSocial = output<void>();
  readonly toggleGuild = output<void>();
  readonly toggleArena = output<void>();
  readonly toggleMail = output<void>();
  readonly toggleM7 = output<void>();

  readonly statusLabel = computed(() => CONNECTION_LABELS[this.status()]);
  readonly online = computed(() => this.status() === 'ready');
  readonly latencyLabel = computed(() => {
    const latency = this.latencyMs();
    return latency === null ? '—' : `${latency} ms`;
  });

  readonly level = computed(() => this.character()?.level ?? 1);
  /** Cấp tối đa thì không còn kinh nghiệm cần tích, hiện chữ thay vì thanh rỗng khó hiểu. */
  readonly maxLevel = computed(() => this.level() >= LEVEL_MAX);
  readonly expPercent = computed(() => {
    const stats = this.character();
    if (!stats || stats.expToNext <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((stats.exp / stats.expToNext) * 100)));
  });

  percent(value: number, max: number): number {
    if (max <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  }
}

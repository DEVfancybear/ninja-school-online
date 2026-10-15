import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CONNECTION_LABELS, type ConnectionStatus } from '../../net/game-socket';

/** Thanh thông tin trên cùng khi chơi: nhân vật, bản đồ, độ trễ, trạng thái kết nối. */
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

  readonly toggleChat = output<void>();

  readonly statusLabel = computed(() => CONNECTION_LABELS[this.status()]);
  readonly online = computed(() => this.status() === 'ready');
  readonly latencyLabel = computed(() => {
    const latency = this.latencyMs();
    return latency === null ? '—' : `${latency} ms`;
  });
}

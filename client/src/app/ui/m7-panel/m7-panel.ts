import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { M7State } from '@ninja/shared';

@Component({
  selector: 'app-m7-panel',
  templateUrl: './m7-panel.html',
  styleUrl: './m7-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M7Panel {
  readonly state = input<M7State | null>(null);
  readonly closed = output<void>();
  readonly claimLogin = output<void>();

  utcTime(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(11, 16) + ' UTC';
  }
}

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

  utcDateTime(timestamp: number): string {
    const iso = new Date(timestamp).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }
}

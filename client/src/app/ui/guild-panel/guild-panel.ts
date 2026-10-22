import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { GuildUpdate } from '@ninja/shared';

@Component({
  selector: 'app-guild-panel',
  templateUrl: './guild-panel.html',
  styleUrl: './guild-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuildPanel {
  readonly state = input.required<GuildUpdate>();
  readonly closed = output<void>();
  readonly create = output<string>();
  readonly join = output<string>();
  readonly leave = output<void>();
  readonly name = signal('');

  onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value.slice(0, 24));
  }

  submit(action: 'create' | 'join'): void {
    const name = this.name().trim();
    if (name.length < 3) return;
    (action === 'create' ? this.create : this.join).emit(name);
    this.name.set('');
  }
}

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { NpcDialog } from '@ninja/shared';

/** Panel hội thoại NPC: tên NPC, từng dòng nói và nút đóng. */
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
}

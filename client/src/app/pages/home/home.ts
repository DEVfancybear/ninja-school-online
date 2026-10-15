import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  readonly title = 'Ninja School Online';
  readonly stage = 'Giai đoạn 0 — nền móng (M0)';
  readonly stack = 'Angular + Phaser · Node.js · PostgreSQL + Redis';
}

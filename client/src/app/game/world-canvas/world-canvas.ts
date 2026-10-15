import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type OnDestroy,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import Phaser from 'phaser';
import { buildGameConfig } from '../game-config';

/**
 * Sân khấu thế giới: một component Angular bọc một canvas Phaser.
 * Angular quản lý vòng đời (tạo/huỷ Phaser), Phaser chỉ vẽ phần thế giới 2D.
 */
@Component({
  selector: 'app-world-canvas',
  imports: [RouterLink],
  templateUrl: './world-canvas.html',
  styleUrl: './world-canvas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorldCanvas implements AfterViewInit, OnDestroy {
  private readonly canvasHost = viewChild.required<ElementRef<HTMLDivElement>>('canvasHost');
  private game?: Phaser.Game;

  ngAfterViewInit(): void {
    this.game = new Phaser.Game(buildGameConfig(this.canvasHost().nativeElement));
  }

  ngOnDestroy(): void {
    this.game?.destroy(true);
    this.game = undefined;
  }
}

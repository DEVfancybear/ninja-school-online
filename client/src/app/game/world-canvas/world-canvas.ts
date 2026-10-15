import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TICK_RATE_MS, type MapSnapshot } from '@ninja/shared';
import Phaser from 'phaser';
import { type Facing, type WorldEntity } from '../../net/world-types';
import { buildGameConfig } from '../game-config';
import { type Point } from '../world-logic';
import { WorldScene, type WorldSceneState } from '../world-scene';

/**
 * Sân khấu thế giới: một component Angular bọc một canvas Phaser.
 * Angular quản lý vòng đời (tạo/huỷ Phaser) và truyền dữ liệu thế giới xuống cảnh qua
 * signal input; Phaser chỉ vẽ phần 2D và báo ngược lại sự kiện bấm chuột.
 */
@Component({
  selector: 'app-world-canvas',
  templateUrl: './world-canvas.html',
  styleUrl: './world-canvas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorldCanvas implements AfterViewInit, OnDestroy {
  readonly map = input<MapSnapshot | null>(null);
  readonly entities = input<readonly WorldEntity[]>([]);
  readonly selfId = input<string | null>(null);
  /** Hướng nhân vật của mình theo phím đang giữ (phản hồi tức thì, không chờ server). */
  readonly selfFacing = input<Facing | null>(null);
  /** Nhịp tick server, dùng làm thời lượng nội suy giữa hai gói vị trí. */
  readonly tickRateMs = input<number>(TICK_RATE_MS);

  /** Người chơi bấm vào một ô trên bản đồ. */
  readonly moveTo = output<Point>();
  /** Người chơi bấm vào một NPC. */
  readonly talkTo = output<string>();

  private readonly canvasHost = viewChild.required<ElementRef<HTMLDivElement>>('canvasHost');
  private scene?: WorldScene;
  private game?: Phaser.Game;

  constructor() {
    // Mọi thay đổi của thế giới (map, thực thể, hướng) đẩy xuống cảnh ở đây; cảnh giữ trạng
    // thái mới nhất nên không sợ hiệu ứng chạy trước khi Phaser khởi tạo xong.
    effect(() => {
      const state: WorldSceneState = {
        map: this.map(),
        entities: this.entities(),
        selfId: this.selfId(),
        selfFacing: this.selfFacing(),
        tickRateMs: this.tickRateMs(),
      };
      this.scene?.syncWorld(state);
    });
  }

  ngAfterViewInit(): void {
    const scene = new WorldScene({
      moveTo: (destination) => this.moveTo.emit(destination),
      talkTo: (npcId) => this.talkTo.emit(npcId),
    });
    this.scene = scene;
    this.game = new Phaser.Game(buildGameConfig(this.canvasHost().nativeElement, scene));
    // Phaser khởi tạo cảnh ở lần tick kế tiếp, nhưng trạng thái đã có sẵn: nạp ngay bây giờ để
    // cảnh không vẽ ra màn hình trống ở khung hình đầu tiên.
    scene.syncWorld({
      map: this.map(),
      entities: this.entities(),
      selfId: this.selfId(),
      selfFacing: this.selfFacing(),
      tickRateMs: this.tickRateMs(),
    });
  }

  ngOnDestroy(): void {
    this.game?.destroy(true);
    this.game = undefined;
    this.scene = undefined;
  }
}

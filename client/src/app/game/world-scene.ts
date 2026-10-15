import Phaser from 'phaser';
import { TICK_RATE_MS, type MapSnapshot } from '@ninja/shared';
import type { Facing, WorldEntity } from '../net/world-types';
import {
  buildTileLookup,
  entityAtPoint,
  entityStyle,
  facingVector,
  interpolatePosition,
  isBlockedTile,
  parseHexColor,
  tileAt,
  tileCenterWorld,
  worldToTile,
  type MapTile,
  type Point,
  type TileLayer,
} from './world-logic';

export const WORLD_SCENE_KEY = 'world';

/** Màu viền phân biệt: nhân vật của mình, NPC, rồi người chơi khác. */
const SELF_BORDER_COLOR = 0x7fd1ff;
const NPC_BORDER_COLOR = 0xf0d9a0;
const OTHER_BORDER_COLOR = 0x0b1218;

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: '12px',
  color: '#e8f1f8',
  stroke: '#0b1218',
  strokeThickness: 3,
};

/** Việc cần làm khi người chơi bấm vào sân khấu; nối ra tầng Angular. */
export interface WorldSceneHooks {
  readonly moveTo: (destination: Point) => void;
  readonly talkTo: (npcId: string) => void;
}

/** Toàn bộ dữ liệu cảnh cần để vẽ, gom thành một gói để cập nhật nguyên tử. */
export interface WorldSceneState {
  readonly map: MapSnapshot | null;
  readonly entities: readonly WorldEntity[];
  readonly selfId: string | null;
  readonly selfFacing: Facing | null;
  readonly tickRateMs: number;
}

interface MoveSegment {
  readonly from: Point;
  readonly to: Point;
  readonly startedAt: number;
}

interface EntityView {
  readonly container: Phaser.GameObjects.Container;
  readonly shape: Phaser.GameObjects.Graphics;
  readonly marker: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  entity: WorldEntity;
  drawn: Point;
  segment: MoveSegment | null;
  facing: Facing;
  styleKey: string;
}

const EMPTY_STATE: WorldSceneState = {
  map: null,
  entities: [],
  selfId: null,
  selfFacing: null,
  tickRateMs: TICK_RATE_MS,
};

/**
 * Cảnh thế giới của M2: vẽ tilemap thật từ `MapSnapshot` (gạch là hình chữ nhật màu vì chưa có
 * tài nguyên hình), vẽ thực thể kèm tên, camera đi theo nhân vật của mình và **nội suy** vị trí
 * giữa hai gói `S2C_ENTITY_MOVE` (server 10 Hz, client 60 fps).
 *
 * Mọi phép tính nằm trong `world-logic.ts`; cảnh này chỉ vẽ và chuyển tiếp sự kiện bấm.
 * Nhận `hooks` qua hàm dựng (Phaser cho phép truyền thẳng **thể hiện** cảnh trong `scene`),
 * nhờ vậy không cần cơ chế tiêm phụ thuộc riêng của Phaser.
 */
export class WorldScene extends Phaser.Scene {
  private readonly hooks: WorldSceneHooks;
  private state: WorldSceneState = EMPTY_STATE;
  private booted = false;
  private tiles?: Phaser.GameObjects.Graphics;
  private readonly views = new Map<string, EntityView>();
  private followed: Phaser.GameObjects.Container | null = null;

  constructor(hooks: WorldSceneHooks) {
    super(WORLD_SCENE_KEY);
    this.hooks = hooks;
  }

  create(): void {
    this.booted = true;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointer(pointer);
    });
    // Dữ liệu thế giới có thể đã tới trước khi Phaser gọi `create()` (ảnh hiệu ứng của Angular
    // chạy ngay sau khi dựng cảnh), nên ở đây phải vẽ lại từ đầu chứ không chỉ áp thực thể.
    this.redrawMap();
    this.applyState();
  }

  override update(): void {
    this.updatePositions();
  }

  /** Cập nhật map + thực thể; gọi từ hiệu ứng của Angular mỗi khi trạng thái thế giới đổi. */
  syncWorld(state: WorldSceneState): void {
    const mapChanged = this.state.map !== state.map;
    this.state = state;
    if (!this.booted) {
      return;
    }
    if (mapChanged) {
      this.redrawMap();
    }
    this.applyState();
  }

  // ------------------------------------------------------------------ vẽ map

  private applyState(): void {
    if (!this.booted) {
      return;
    }
    this.applyEntities();
  }

  private redrawMap(): void {
    this.clearViews();
    this.tiles?.destroy();
    this.tiles = undefined;

    const map = this.state.map;
    if (!map) {
      this.cameras.main.setBounds(0, 0, this.scale.width, this.scale.height);
      return;
    }

    const lookup = buildTileLookup(map.tiles);
    const graphics = this.add.graphics();
    this.drawLayer(graphics, map.ground, lookup, map.tileSize);
    this.drawLayer(graphics, map.decor, lookup, map.tileSize);
    this.tiles = graphics;
    this.cameras.main.setBounds(0, 0, map.width * map.tileSize, map.height * map.tileSize);
  }

  private drawLayer(
    graphics: Phaser.GameObjects.Graphics,
    layer: TileLayer,
    lookup: ReadonlyMap<number, MapTile>,
    tileSize: number,
  ): void {
    for (let row = 0; row < layer.length; row += 1) {
      const columns = layer[row]?.length ?? 0;
      for (let col = 0; col < columns; col += 1) {
        const tile = tileAt(layer, lookup, col, row);
        if (!tile) {
          continue;
        }
        graphics.fillStyle(parseHexColor(tile.color), 1);
        graphics.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
        // Viền mờ để nhìn ra lưới ô mà không cần tài nguyên hình.
        graphics.lineStyle(1, 0x000000, 0.15);
        graphics.strokeRect(col * tileSize, row * tileSize, tileSize, tileSize);
      }
    }
  }

  // -------------------------------------------------------------- thực thể

  private applyEntities(): void {
    const wanted = new Set(this.state.entities.map((entity) => entity.id));
    for (const [id, view] of Array.from(this.views)) {
      if (!wanted.has(id)) {
        view.container.destroy(true);
        this.views.delete(id);
      }
    }

    for (const entity of this.state.entities) {
      this.syncEntity(entity);
    }

    const selfId = this.state.selfId;
    const selfView = selfId === null ? undefined : this.views.get(selfId);
    this.followSelf(selfView ?? null);
  }

  private syncEntity(entity: WorldEntity): void {
    const isSelf = entity.id === this.state.selfId;
    const styleKey = viewKey(entity, isSelf);
    let view = this.views.get(entity.id);

    if (!view) {
      view = this.createView(entity, isSelf);
      this.views.set(entity.id, view);
    } else if (view.styleKey !== styleKey) {
      this.drawShape(view, entity, isSelf);
    }

    if (view.entity.x !== entity.x || view.entity.y !== entity.y) {
      // Gói mới: nội suy từ vị trí đang vẽ tới vị trí server vừa báo.
      view.segment = {
        from: view.drawn,
        to: { x: entity.x, y: entity.y },
        startedAt: this.time.now,
      };
    }

    // Nhân vật của mình quay theo phím vừa bấm để phản hồi tức thì, không chờ server xác nhận.
    const facing = isSelf && this.state.selfFacing !== null ? this.state.selfFacing : entity.facing;
    if (facing !== view.facing) {
      view.facing = facing;
      this.drawFacingMarker(view);
    }

    view.entity = entity;
    if (view.label.text !== entity.name) {
      view.label.setText(entity.name);
    }
  }

  private createView(entity: WorldEntity, isSelf: boolean): EntityView {
    const style = entityStyle(entity.kind);
    const shape = this.add.graphics();
    const marker = this.add.graphics();
    const label = this.add
      .text(0, -style.height / 2 - 16, entity.name, LABEL_STYLE)
      .setOrigin(0.5, 0);
    const container = this.add.container(entity.x, entity.y, [shape, marker, label]);

    const view: EntityView = {
      container,
      shape,
      marker,
      label,
      entity,
      drawn: { x: entity.x, y: entity.y },
      segment: null,
      facing: entity.facing,
      styleKey: viewKey(entity, isSelf),
    };
    this.drawShape(view, entity, isSelf);
    this.drawFacingMarker(view);
    return view;
  }

  private drawShape(view: EntityView, entity: WorldEntity, isSelf: boolean): void {
    const style = entityStyle(entity.kind);
    const left = -style.width / 2;
    const top = -style.height / 2;
    const border =
      isSelf ? SELF_BORDER_COLOR : entity.kind === 'npc' ? NPC_BORDER_COLOR : OTHER_BORDER_COLOR;

    view.shape.clear();
    view.shape.fillStyle(parseHexColor(entity.color), 1);
    view.shape.fillRoundedRect(left, top, style.width, style.height, style.radius);
    view.shape.lineStyle(isSelf || entity.kind === 'npc' ? 2 : 1, border, 1);
    view.shape.strokeRoundedRect(left, top, style.width, style.height, style.radius);
    view.styleKey = viewKey(entity, isSelf);
  }

  private drawFacingMarker(view: EntityView): void {
    const style = entityStyle(view.entity.kind);
    const vector = facingVector(view.facing);
    view.marker.clear();
    if (vector.x === 0 && vector.y === 0) {
      return;
    }
    const offset = style.width / 2 + 6;
    view.marker.fillStyle(0xffffff, 0.95);
    view.marker.fillCircle(vector.x * offset, vector.y * offset, 3);
  }

  private followSelf(view: EntityView | null): void {
    const target = view?.container ?? null;
    if (this.followed === target) {
      return;
    }
    this.followed = target;
    if (target) {
      this.cameras.main.startFollow(target, false, 0.2, 0.2);
    } else {
      this.cameras.main.stopFollow();
    }
  }

  private clearViews(): void {
    for (const view of this.views.values()) {
      view.container.destroy(true);
    }
    this.views.clear();
    this.followed = null;
    this.cameras.main.stopFollow();
  }

  // ----------------------------------------------------------- mỗi khung hình

  private updatePositions(): void {
    const now = this.time.now;
    for (const view of this.views.values()) {
      const segment = view.segment;
      if (segment) {
        view.drawn = interpolatePosition(
          segment.from,
          segment.to,
          now - segment.startedAt,
          this.state.tickRateMs,
        );
        if (now - segment.startedAt >= this.state.tickRateMs) {
          view.segment = null;
        }
      }
      view.container.setPosition(view.drawn.x, view.drawn.y);
      // Thực thể ở dưới (y lớn hơn) được vẽ đè lên thực thể ở trên.
      view.container.setDepth(view.drawn.y);
    }
  }

  // ------------------------------------------------------------ bấm chuột

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    const point = { x: pointer.worldX, y: pointer.worldY };
    const hit = entityAtPoint(this.state.entities, point);
    if (hit && hit.kind === 'npc') {
      this.hooks.talkTo(hit.id);
      return;
    }

    const map = this.state.map;
    if (!map) {
      return;
    }
    const tile = worldToTile(map, point);
    if (!tile || isBlockedTile(map, tile.col, tile.row)) {
      // Ô ngoài biên hoặc ô chặn đi: bỏ qua, server cũng sẽ từ chối lệnh này.
      return;
    }
    this.hooks.moveTo(tileCenterWorld(map, tile.col, tile.row));
  }
}

function viewKey(entity: WorldEntity, isSelf: boolean): string {
  return `${entity.kind}|${entity.color}|${isSelf ? 'self' : 'other'}`;
}

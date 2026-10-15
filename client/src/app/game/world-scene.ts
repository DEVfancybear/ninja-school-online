import Phaser from 'phaser';
import { TICK_RATE_MS, type MapSnapshot } from '@ninja/shared';
import type { Facing, WorldEntity } from '../net/world-types';
import {
  drawCharacter,
  drawTile,
  lookDirection,
  type TileLayerKind,
  type TileNeighbourhood,
} from './tile-art';
import {
  buildTileLookup,
  entityAtPoint,
  entityStyle,
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

/**
 * Hệ số phóng của camera. Màn hình 1100×760 với ô 32 px mà không phóng thì nhân vật chỉ cao ~24 px,
 * nhìn như hạt bụi; phóng lên cho thế giới có tỉ lệ gần với game 2D thương mại.
 */
export const CAMERA_ZOOM = 1.6;

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
 * Cảnh thế giới của M2: vẽ tilemap thật từ `MapSnapshot`, vẽ nhân vật kèm tên, camera đi theo nhân
 * vật của mình (có phóng to) và **nội suy** vị trí giữa hai gói `S2C_ENTITY_MOVE` (server 10 Hz,
 * client 60 fps).
 *
 * Hình ảnh được **sinh từ hình khối trong mã** (`tile-art.ts`) chứ không dùng tài nguyên hình: dự
 * án chưa có asset đồ họa và sẽ không sao chép tài nguyên của game khác.
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
    // Nền ngoài bản đồ: nếu không tô, mép bản đồ trông như lỗ thủng khi camera chạm biên.
    graphics.fillStyle(0x101820, 1);
    graphics.fillRect(-64, -64, map.width * map.tileSize + 128, map.height * map.tileSize + 128);
    this.drawLayer(graphics, map.ground, lookup, map.tileSize, 'ground');
    this.drawLayer(graphics, map.decor, lookup, map.tileSize, 'decor');
    this.tiles = graphics;
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.setBounds(0, 0, map.width * map.tileSize, map.height * map.tileSize);
  }

  private drawLayer(
    graphics: Phaser.GameObjects.Graphics,
    layer: TileLayer,
    lookup: ReadonlyMap<number, MapTile>,
    tileSize: number,
    kind: TileLayerKind,
  ): void {
    for (let row = 0; row < layer.length; row += 1) {
      const columns = layer[row]?.length ?? 0;
      for (let col = 0; col < columns; col += 1) {
        const tile = tileAt(layer, lookup, col, row);
        if (!tile) {
          continue;
        }
        // Ô bên cạnh quyết định mép tiếp giáp (cỏ vào đường đất, bờ nước, diềm mái, chân tường).
        drawTile(graphics, tile, col, row, tileSize, kind, neighbourIds(layer, col, row));
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
    // Tên nằm trên đầu nhân vật, chừa chỗ cho nón lá của NPC.
    const label = this.add
      .text(0, -(style.height * 0.9 + 8), entity.name, LABEL_STYLE)
      .setOrigin(0.5, 0);
    const container = this.add.container(entity.x, entity.y, [shape, label]);

    const view: EntityView = {
      container,
      shape,
      label,
      entity,
      drawn: { x: entity.x, y: entity.y },
      segment: null,
      facing: entity.facing,
      styleKey: viewKey(entity, isSelf),
    };
    this.drawShape(view, entity, isSelf);
    return view;
  }

  /**
   * Vẽ lại nhân vật: hình khối sinh trong `tile-art.ts` (không có tài nguyên hình). Nhân vật của
   * mình có vòng sáng dưới chân, NPC đội nón lá và có râu.
   */
  private drawShape(view: EntityView, entity: WorldEntity, isSelf: boolean): void {
    const style = entityStyle(entity.kind);
    view.shape.clear();
    view.shape.setPosition(0, 0);
    drawCharacter(
      view.shape,
      {
        color: parseHexColor(entity.color),
        height: entity.kind === 'npc' ? style.height : style.height + 2,
        highlight: isSelf,
        elder: entity.kind === 'npc',
      },
      lookDirection(view.facing, false),
    );
    view.styleKey = viewKey(entity, isSelf);
  }

  /** Hướng đi nằm ngay trong hình nhân vật (mắt, tóc, tay), nên đổi hướng = vẽ lại hình. */
  private drawFacingMarker(view: EntityView): void {
    this.drawShape(view, view.entity, view.entity.id === this.state.selfId);
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

/** Id gạch của bốn ô kề trong cùng một lớp; `-1` khi ô trống hoặc ngoài biên. */
function neighbourIds(layer: TileLayer, col: number, row: number): TileNeighbourhood {
  const at = (c: number, r: number): number => layer[r]?.[c] ?? -1;
  return {
    up: at(col, row - 1),
    down: at(col, row + 1),
    left: at(col - 1, row),
    right: at(col + 1, row),
  };
}

function viewKey(entity: WorldEntity, isSelf: boolean): string {
  return `${entity.kind}|${entity.color}|${isSelf ? 'self' : 'other'}`;
}

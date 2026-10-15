import { type Entity, type EntityMove } from '@ninja/shared';

/**
 * Kiểu suy ra trực tiếp từ hợp đồng mạng trong `@ninja/shared`, không định nghĩa lại:
 * hướng 8 chiều (kèm `none` khi đứng yên) và một mục trong gói `S2C_ENTITY_MOVE`.
 */
export type Facing = EntityMove['moves'][number]['facing'];
export type EntityMoveItem = EntityMove['moves'][number];

/**
 * Thực thể như phía client đang biết: dữ liệu của hợp đồng (`Entity`) cộng hướng vẽ,
 * vì `S2C_ENTITY_MOVE` mới là nơi server gửi hướng đi.
 */
export interface WorldEntity extends Entity {
  readonly facing: Facing;
}

export function worldEntityFrom(entity: Entity, facing: Facing = 'none'): WorldEntity {
  return { ...entity, facing };
}

/** Thêm mới hoặc thay thế theo `id`, giữ nguyên thứ tự cũ để danh sách không nhảy. */
export function upsertEntity(
  entities: readonly WorldEntity[],
  incoming: WorldEntity,
): WorldEntity[] {
  const index = entities.findIndex((entity) => entity.id === incoming.id);
  if (index < 0) {
    return [...entities, incoming];
  }
  const next = entities.slice();
  next[index] = incoming;
  return next;
}

export function removeEntity(entities: readonly WorldEntity[], id: string): WorldEntity[] {
  return entities.filter((entity) => entity.id !== id);
}

/**
 * Áp các vị trí trong `S2C_ENTITY_MOVE` lên danh sách hiện có.
 * Thực thể lạ (chưa từng vào tầm nhìn) bị bỏ qua: server là bên quyết định ai được thấy,
 * nên `S2C_ENTITY_ADD` mới là nguồn thêm thực thể.
 */
export function applyEntityMoves(
  entities: readonly WorldEntity[],
  moves: readonly EntityMoveItem[],
): WorldEntity[] {
  if (moves.length === 0) {
    return entities.slice();
  }
  const byId = new Map(moves.map((move) => [move.id, move]));
  return entities.map((entity) => {
    const move = byId.get(entity.id);
    return move ? { ...entity, x: move.x, y: move.y, facing: move.facing } : entity;
  });
}

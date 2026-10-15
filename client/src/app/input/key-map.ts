import type { Point } from '../game/world-logic';

/** Bốn hướng cơ bản lấy từ bàn phím; giữ hai phím cùng lúc thì thành hướng chéo. */
export type ArrowDirection = 'n' | 's' | 'e' | 'w';

/**
 * Phím → hướng. Hỗ trợ WASD (không phân biệt hoa thường) và các phím mũi tên.
 * `event.key` của phím mũi tên là `ArrowUp`... nên tra cứu luôn hạ chữ thường.
 */
export const KEY_DIRECTIONS: Readonly<Record<string, ArrowDirection>> = {
  w: 'n',
  arrowup: 'n',
  s: 's',
  arrowdown: 's',
  a: 'w',
  arrowleft: 'w',
  d: 'e',
  arrowright: 'e',
};

export function directionForKey(key: string): ArrowDirection | null {
  return KEY_DIRECTIONS[key.toLowerCase()] ?? null;
}

/** Véc-tơ đơn vị của tập hướng đang giữ; hai hướng chéo nhau cho véc-tơ dài bằng 1. */
export function vectorForDirections(directions: Iterable<ArrowDirection>): Point {
  let x = 0;
  let y = 0;
  for (const direction of directions) {
    if (direction === 'n') {
      y -= 1;
    } else if (direction === 's') {
      y += 1;
    } else if (direction === 'e') {
      x += 1;
    } else {
      x -= 1;
    }
  }
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

/**
 * Người chơi đang gõ vào một ô nhập liệu (thường là ô chat): các phím WASD/mũi tên phải
 * thuộc về ô nhập, không được điều khiển nhân vật.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName.toUpperCase());
}

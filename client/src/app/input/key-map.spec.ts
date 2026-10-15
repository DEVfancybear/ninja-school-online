import { describe, expect, it } from 'vitest';
import { directionForKey, isTypingTarget, vectorForDirections } from './key-map';

describe('directionForKey', () => {
  it('nhận WASD không phân biệt hoa thường', () => {
    expect(directionForKey('w')).toBe('n');
    expect(directionForKey('W')).toBe('n');
    expect(directionForKey('a')).toBe('w');
    expect(directionForKey('s')).toBe('s');
    expect(directionForKey('d')).toBe('e');
  });

  it('nhận cả phím mũi tên', () => {
    expect(directionForKey('ArrowUp')).toBe('n');
    expect(directionForKey('ArrowDown')).toBe('s');
    expect(directionForKey('ArrowLeft')).toBe('w');
    expect(directionForKey('ArrowRight')).toBe('e');
  });

  it('phím khác thì trả về null', () => {
    expect(directionForKey('Enter')).toBeNull();
    expect(directionForKey(' ')).toBeNull();
    expect(directionForKey('x')).toBeNull();
  });
});

describe('vectorForDirections', () => {
  it('một hướng cho véc-tơ đơn vị', () => {
    expect(vectorForDirections(['n'])).toEqual({ x: 0, y: -1 });
    expect(vectorForDirections(['e'])).toEqual({ x: 1, y: 0 });
  });

  it('hai hướng vuông góc cho véc-tơ chéo dài bằng 1', () => {
    const vector = vectorForDirections(['n', 'e']);
    expect(vector.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(vector.y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(1, 6);
  });

  it('hai hướng ngược nhau triệt tiêu', () => {
    expect(vectorForDirections(['n', 's'])).toEqual({ x: 0, y: 0 });
    expect(vectorForDirections(['w', 'e'])).toEqual({ x: 0, y: 0 });
  });

  it('không giữ hướng nào thì véc-tơ bằng 0', () => {
    expect(vectorForDirections([])).toEqual({ x: 0, y: 0 });
  });
});

describe('isTypingTarget', () => {
  it('nhận ra ô nhập liệu', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
  });

  it('bỏ qua vùng không phải ô nhập liệu', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });

  it('coi vùng soạn thảo trực tiếp là ô nhập liệu', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    // jsdom không luôn suy ra `isContentEditable` từ thuộc tính, nên gán thẳng cho chắc.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTypingTarget(editable)).toBe(true);
  });
});

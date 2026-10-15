import { describe, expect, it } from 'vitest';
import { type Point } from '../game/world-logic';
import { MOVE_COMMAND_INTERVAL_MS, MOVE_LEAD_PX, MovementController } from './movement-controller';

const SELF: Point = { x: 200, y: 200 };

function setup() {
  const sent: Point[] = [];
  const controller = new MovementController((destination) => {
    sent.push(destination);
  });
  return { controller, sent };
}

describe('MovementController', () => {
  it('nhận phím di chuyển và bỏ qua phím khác', () => {
    const { controller } = setup();

    expect(controller.press('Enter')).toBe(false);
    expect(controller.moving).toBe(false);

    expect(controller.press('w')).toBe(true);
    expect(controller.moving).toBe(true);
    expect(controller.facing()).toBe('n');

    expect(controller.release('Enter')).toBe(false);
    expect(controller.release('w')).toBe(true);
    expect(controller.moving).toBe(false);
    expect(controller.facing()).toBe('none');
  });

  it('giữ phím thì gửi đích trước mặt, không gửi mỗi khung hình', () => {
    const { controller, sent } = setup();
    controller.press('w');

    expect(controller.tick(1000, SELF)).toEqual({ x: 200, y: 200 - MOVE_LEAD_PX });
    expect(sent).toHaveLength(1);

    // Trong cùng một nhịp gửi: không có lệnh mới nào.
    expect(controller.tick(1050, SELF)).toBeNull();
    expect(controller.tick(MOVE_COMMAND_INTERVAL_MS + 999, SELF)).toBeNull();
    expect(sent).toHaveLength(1);

    // Quá nhịp thì gửi tiếp để nhân vật không dừng giữa đường.
    expect(controller.tick(1000 + MOVE_COMMAND_INTERVAL_MS, SELF)).not.toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('đi chéo thì véc-tơ được chuẩn hoá', () => {
    const { controller, sent } = setup();
    controller.press('w');
    controller.press('d');

    controller.tick(0, SELF);

    expect(sent[0].x).toBeCloseTo(200 + MOVE_LEAD_PX * Math.SQRT1_2, 6);
    expect(sent[0].y).toBeCloseTo(200 - MOVE_LEAD_PX * Math.SQRT1_2, 6);
    expect(controller.facing()).toBe('ne');
  });

  it('nhả hết phím thì gửi lệnh dừng tại vị trí hiện tại, đúng một lần', () => {
    const { controller, sent } = setup();
    controller.press('a');
    controller.tick(0, SELF);
    controller.release('a');

    expect(controller.tick(100, SELF)).toEqual({ x: 200, y: 200 });
    expect(controller.tick(200, SELF)).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('còn giữ một phím khác thì chưa gửi lệnh dừng', () => {
    const { controller, sent } = setup();
    controller.press('a');
    controller.press('w');
    controller.tick(0, SELF);
    controller.release('a');

    expect(controller.tick(100, SELF)).toEqual({ x: 200, y: 200 - MOVE_LEAD_PX });
    expect(sent.at(-1)?.y).toBe(200 - MOVE_LEAD_PX);
  });

  it('bấm chuột thì đi tới đúng điểm, chờ tới nhịp mới gửi', () => {
    const { controller, sent } = setup();
    controller.requestDestination({ x: 320, y: 320 });

    expect(controller.tick(0, SELF)).toEqual({ x: 320, y: 320 });
    expect(controller.tick(50, SELF)).toBeNull();

    controller.requestDestination({ x: 640, y: 640 });
    expect(controller.tick(60, SELF)).toBeNull();
    expect(controller.tick(100, SELF)).toEqual({ x: 640, y: 640 });
    expect(sent).toHaveLength(2);
  });

  it('chưa biết vị trí nhân vật thì chưa gửi gì, biết rồi thì gửi lại ý định cũ', () => {
    const { controller, sent } = setup();
    controller.requestDestination({ x: 320, y: 320 });

    expect(controller.tick(0, null)).toBeNull();
    expect(sent).toHaveLength(0);
    expect(controller.tick(0, SELF)).toEqual({ x: 320, y: 320 });
  });

  it('bấm phím thì bỏ ý định bấm chuột trước đó', () => {
    const { controller, sent } = setup();
    controller.requestDestination({ x: 320, y: 320 });
    controller.press('d');

    controller.tick(0, SELF);
    expect(sent).toEqual([{ x: 200 + MOVE_LEAD_PX, y: 200 }]);
  });

  it('không gửi gì khi không giữ phím và không có ý định nào', () => {
    const { controller, sent } = setup();
    expect(controller.tick(0, SELF)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('reset() quên hết phím đang giữ và cả nhịp gửi', () => {
    const { controller, sent } = setup();
    controller.press('w');
    controller.tick(0, SELF);

    controller.reset();
    expect(controller.moving).toBe(false);
    expect(controller.facing()).toBe('none');
    expect(controller.tick(10, SELF)).toBeNull();

    controller.press('s');
    // Nhịp gửi đã được đặt lại nên gửi được ngay, không phải chờ 100ms.
    expect(controller.tick(10, SELF)).toEqual({ x: 200, y: 200 + MOVE_LEAD_PX });
    expect(sent).toHaveLength(2);
  });
});

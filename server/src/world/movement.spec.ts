import { describe, expect, it } from 'vitest';
import { MAX_MOVE_DISTANCE_PX, PLAYER_SPEED_PX_PER_SEC, TICK_RATE_MS } from '@ninja/shared';
import { loadGameData } from './game-data.js';
import { MapInstance } from './map.js';
import { ARRIVE_EPSILON_PX, MOVE_STEP_PX, checkMove, facingFor, stepTowards } from './movement.js';

const gameData = await loadGameData();
const village = new MapInstance(gameData.maps.get('lang-khoi-nguon')!);
const SPAWN = { x: 656, y: 528 };

describe('bước đi mỗi nhịp', () => {
  it('mỗi nhịp đi đúng PLAYER_SPEED_PX_PER_SEC × 0,1 s', () => {
    expect(MOVE_STEP_PX).toBe((PLAYER_SPEED_PX_PER_SEC * TICK_RATE_MS) / 1000);
    expect(MOVE_STEP_PX).toBe(16);
    expect(ARRIVE_EPSILON_PX).toBe(0.5);

    const step = stepTowards(SPAWN, { x: SPAWN.x + 160, y: SPAWN.y });
    expect(step.arrived).toBe(false);
    expect(step.x).toBe(SPAWN.x + 16);

    const diagonal = stepTowards({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(MOVE_STEP_PX, 6);
  });

  it('tới đích sau đúng số nhịp rồi dừng đúng toạ độ đích', () => {
    const target = { x: SPAWN.x + 160, y: SPAWN.y };
    let position = { x: SPAWN.x, y: SPAWN.y };
    let ticks = 0;

    for (let index = 0; index < 100; index += 1) {
      const step = stepTowards(position, target);
      position = { x: step.x, y: step.y };
      ticks += 1;
      if (step.arrived) {
        break;
      }
    }

    expect(ticks).toBe(10);
    expect(position).toEqual(target);
  });

  it('đích gần hơn một bước thì tới luôn trong nhịp đó', () => {
    const step = stepTowards(SPAWN, { x: SPAWN.x + 3, y: SPAWN.y });
    expect(step).toEqual({ x: SPAWN.x + 3, y: SPAWN.y, arrived: true });
  });
});

describe('kiểm tra lệnh di chuyển', () => {
  it('nhận lệnh hợp lệ trong tầm và trên ô đi được', () => {
    expect(checkMove(village, SPAWN, { x: SPAWN.x + MAX_MOVE_DISTANCE_PX, y: SPAWN.y })).toBe(
      undefined,
    );
    expect(checkMove(village, SPAWN, { x: SPAWN.x + 64, y: SPAWN.y })).toBeUndefined();
  });

  it('từ chối khi xa quá MAX_MOVE_DISTANCE_PX', () => {
    expect(checkMove(village, SPAWN, { x: SPAWN.x + MAX_MOVE_DISTANCE_PX + 1, y: SPAWN.y })).toBe(
      'too_far',
    );
  });

  it('từ chối khi ra ngoài biên bản đồ', () => {
    // Biên dưới/phải không thuộc bản đồ, biên trên/trái thì có.
    expect(village.contains(0, 0)).toBe(true);
    expect(village.contains(village.pixelWidth - 1, village.pixelHeight - 1)).toBe(true);
    expect(village.contains(village.pixelWidth, 16)).toBe(false);
    expect(village.contains(16, village.pixelHeight)).toBe(false);
    expect(village.contains(-1, 16)).toBe(false);
    // Ô ngoài bản đồ cũng là ô bị chặn.
    expect(village.isBlockedTile(-1, 0)).toBe(true);
    expect(village.isBlockedTile(village.width, 0)).toBe(true);

    // Đích dưới đáy bản đồ nằm trong tầm đi nhưng bị từ chối vì ngoài biên.
    expect(checkMove(village, SPAWN, { x: SPAWN.x, y: village.pixelHeight })).toBe('out_of_bounds');
    // Điểm xa quá tầm thì bị từ chối vì khoảng cách trước (kiểm tra theo thứ tự này).
    expect(checkMove(village, SPAWN, { x: 0, y: 0 })).toBe('too_far');
  });

  it('từ chối khi đích nằm trong ô bị chặn', () => {
    // Ô (21, 17) trong lang-khoi-nguon là nước.
    expect(village.isBlockedAt(688, 560)).toBe(true);
    expect(checkMove(village, SPAWN, { x: 688, y: 560 })).toBe('blocked');
    // Điểm spawn là ô đi được.
    expect(village.isBlockedAt(SPAWN.x, SPAWN.y)).toBe(false);
  });
});

describe('hướng 8 chiều', () => {
  it('trả đủ 8 hướng và none khi không dịch chuyển', () => {
    expect(facingFor(16, 0)).toBe('e');
    expect(facingFor(16, 16)).toBe('se');
    expect(facingFor(0, 16)).toBe('s');
    expect(facingFor(-16, 16)).toBe('sw');
    expect(facingFor(-16, 0)).toBe('w');
    expect(facingFor(-16, -16)).toBe('nw');
    expect(facingFor(0, -16)).toBe('n');
    expect(facingFor(16, -16)).toBe('ne');
    expect(facingFor(0, 0)).toBe('none');
  });
});

describe('bản đồ', () => {
  it('điểm spawn là tâm ô gạch', () => {
    expect(village.spawnPosition('default')).toEqual(SPAWN);
    expect(village.spawnPosition('khong-co')).toBeUndefined();
    expect(village.defaultSpawn()).toEqual(SPAWN);
  });

  it('vùng cổng tính theo ô, biên dưới/phải không thuộc cổng', () => {
    // Cổng ở làng: ô x 35..37, y 14..17.
    expect(village.portalAt(1120, 448)?.id).toBe('toi-bai-luyen-tap');
    expect(village.portalAt(1152, 528)?.id).toBe('toi-bai-luyen-tap');
    expect(village.portalAt(1215, 575)?.id).toBe('toi-bai-luyen-tap');
    expect(village.portalAt(1119, 528)).toBeUndefined();
    expect(village.portalAt(1216, 528)).toBeUndefined();
    expect(village.portalAt(1152, 576)).toBeUndefined();
    expect(village.portalAt(SPAWN.x, SPAWN.y)).toBeUndefined();
  });

  it('bản đồ gửi cho client có đủ lớp vẽ và cờ chặn', () => {
    const snapshot = village.toSnapshot();
    expect(snapshot.id).toBe('lang-khoi-nguon');
    expect(snapshot.ground).toHaveLength(30);
    expect(snapshot.decor).toHaveLength(30);
    expect(snapshot.ground[0]).toHaveLength(40);
    expect(snapshot.tiles.every((tile) => typeof tile.blocked === 'boolean')).toBe(true);
  });
});

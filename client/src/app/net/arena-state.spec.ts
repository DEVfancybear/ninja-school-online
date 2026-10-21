import { TestBed } from '@angular/core/testing';
import {
  ARENA_START_RATING,
  Opcode,
  type ArenaEnd,
  type ArenaState as ArenaStatePayload,
  type LeaderboardEntry,
  type LeaderboardView,
} from '@ninja/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArenaState } from './arena-state';

function arenaState(overrides: Partial<ArenaStatePayload> = {}): ArenaStatePayload {
  return {
    queued: false,
    queueSize: 0,
    rating: ARENA_START_RATING,
    wins: 0,
    losses: 0,
    ...overrides,
  };
}

function arenaEnd(overrides: Partial<ArenaEnd> = {}): ArenaEnd {
  return {
    battleId: 'btl:1',
    outcome: 'win',
    reason: 'defeat',
    ratingBefore: 1000,
    ratingAfter: 1016,
    ratingDelta: 16,
    opponentName: 'Sasuke',
    opponentRatingAfter: 984,
    wins: 1,
    losses: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return { rank: 1, name: 'Kakashi', level: 9, school: 'haruna', class: 'dao', ...overrides };
}

function leaderboard(overrides: Partial<LeaderboardView> = {}): LeaderboardView {
  return { board: 'level', entries: [entry()], ...overrides };
}

describe('ArenaState', () => {
  let arena: ArenaState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    arena = TestBed.inject(ArenaState);
  });

  it('bắt đầu với điểm khởi đầu của luật và chưa xếp hàng', () => {
    expect(arena.queued()).toBe(false);
    expect(arena.queueSize()).toBe(0);
    expect(arena.rating()).toBe(ARENA_START_RATING);
    expect(arena.wins()).toBe(0);
    expect(arena.losses()).toBe(0);
    expect(arena.result()).toBeNull();
  });

  it('S2C_ARENA_STATE cập nhật hàng chờ, điểm và thành tích', () => {
    expect(
      arena.applyPacket(Opcode.S2C_ARENA_STATE, arenaState({ queued: true, queueSize: 3 })),
    ).toBe(true);

    expect(arena.queued()).toBe(true);
    expect(arena.queueSize()).toBe(3);
  });

  it('S2C_ARENA_END giữ kết quả trận vừa xong và cập nhật điểm mới ngay', () => {
    arena.applyPacket(Opcode.S2C_ARENA_STATE, arenaState({ queued: true, queueSize: 1 }));

    expect(arena.applyPacket(Opcode.S2C_ARENA_END, arenaEnd())).toBe(true);

    expect(arena.result()?.outcome).toBe('win');
    expect(arena.result()?.ratingDelta).toBe(16);
    // Điểm mới lấy từ chính gói kết thúc, không chờ `S2C_ARENA_STATE` theo sau.
    expect(arena.rating()).toBe(1016);
    expect(arena.wins()).toBe(1);
    // Trận xong thì không còn ai đang chờ ghép.
    expect(arena.queued()).toBe(false);
  });

  it('kết quả còn đó cho tới khi người chơi đóng, rồi mới biến mất', () => {
    arena.applyPacket(Opcode.S2C_ARENA_END, arenaEnd());

    expect(arena.result()).not.toBeNull();
    arena.closeResult();
    expect(arena.result()).toBeNull();
    // Đóng kết quả không xoá điểm vừa cộng.
    expect(arena.rating()).toBe(1016);
  });

  it('S2C_LEADERBOARD nhớ bảng đang xem và thay danh sách', () => {
    expect(
      arena.applyPacket(
        Opcode.S2C_LEADERBOARD,
        leaderboard({ board: 'arena', entries: [entry({ rank: 2, name: 'Sasuke', rating: 984 })] }),
      ),
    ).toBe(true);

    expect(arena.board()).toBe('arena');
    expect(arena.entries().map((item) => item.name)).toEqual(['Sasuke']);
    expect(arena.boardEmpty()).toBe(false);
  });

  it('bảng rỗng thì boardEmpty bật để giao diện vẽ dòng trống', () => {
    arena.applyPacket(Opcode.S2C_LEADERBOARD, leaderboard({ entries: [] }));

    expect(arena.boardEmpty()).toBe(true);
    expect(arena.entries()).toEqual([]);
  });

  it('bỏ qua gói không thuộc phần Lôi Đài và xoá sạch khi reset()', () => {
    expect(arena.applyPacket(Opcode.S2C_SOCIAL_UPDATE, {})).toBe(false);

    arena.applyPacket(Opcode.S2C_ARENA_END, arenaEnd());
    arena.applyPacket(Opcode.S2C_LEADERBOARD, leaderboard({ board: 'arena' }));
    arena.reset();

    expect(arena.result()).toBeNull();
    expect(arena.board()).toBe('level');
    expect(arena.entries()).toEqual([]);
    expect(arena.rating()).toBe(ARENA_START_RATING);
  });
});

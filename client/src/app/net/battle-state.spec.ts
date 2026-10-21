import { TestBed } from '@angular/core/testing';
import {
  BATTLE_TURN_MS,
  Opcode,
  type ArenaEnd,
  type BattleEnd,
  type BattleResult,
  type BattleStart,
  type BattleTurn,
  type Combatant,
} from '@ninja/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleState } from './battle-state';

function combatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'p1',
    kind: 'player',
    name: 'Kakashi',
    level: 1,
    hp: 60,
    maxHp: 60,
    mp: 40,
    maxMp: 40,
    attack: 13,
    defense: 2,
    speed: 6,
    alive: true,
    ...overrides,
  };
}

const MONSTER = combatant({
  id: 'mob:lang-khoi-nguon:1',
  kind: 'monster',
  name: 'Chuột Đồng',
  speed: 7,
});

function start(overrides: Partial<BattleStart> = {}): BattleStart {
  return {
    battleId: 'btl:1',
    roundNo: 1,
    participants: [MONSTER, combatant()],
    actorId: 'p1',
    turnMs: BATTLE_TURN_MS,
    turnEndsAt: Date.now() + BATTLE_TURN_MS,
    mode: 'pve',
    ...overrides,
  };
}

/** Gói kết thúc trận Lôi Đài như server gửi: điểm trước/sau, đối thủ, thành tích mới. */
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

describe('BattleState', () => {
  let battle: BattleState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    battle = TestBed.inject(BattleState);
    battle.setSelfId('p1');
  });

  it('bắt đầu ở trạng thái rỗng', () => {
    expect(battle.battle()).toBeNull();
    expect(battle.log()).toEqual([]);
    expect(battle.outcome()).toBeNull();
    expect(battle.isMyTurn()).toBe(false);
    expect(battle.inBattle()).toBe(false);
  });

  it('S2C_BATTLE_START giữ danh sách người tham gia và biết lượt đang là của ai', () => {
    expect(battle.applyPacket(Opcode.S2C_BATTLE_START, start())).toBe(true);

    expect(battle.inBattle()).toBe(true);
    expect(battle.battle()?.roundNo).toBe(1);
    expect(battle.monster()?.name).toBe('Chuột Đồng');
    expect(battle.me()?.name).toBe('Kakashi');
    expect(battle.isMyTurn()).toBe(true);
    expect(battle.remainingMs()).toBe(BATTLE_TURN_MS);
  });

  it('lượt của quái thì không phải lượt của mình', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start({ actorId: MONSTER.id }));

    expect(battle.isMyTurn()).toBe(false);
    expect(battle.actor()?.name).toBe('Chuột Đồng');
  });

  it('S2C_BATTLE_TURN đổi người đang hành động và vòng đấu', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start());
    const turn: BattleTurn = {
      battleId: 'btl:1',
      roundNo: 2,
      actorId: MONSTER.id,
      turnMs: BATTLE_TURN_MS,
      turnEndsAt: Date.now() + BATTLE_TURN_MS,
    };

    expect(battle.applyPacket(Opcode.S2C_BATTLE_TURN, turn)).toBe(true);
    expect(battle.battle()?.roundNo).toBe(2);
    expect(battle.isMyTurn()).toBe(false);
  });

  it('bỏ qua lượt của trận khác để không trộn hai trận vào nhau', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start());

    battle.applyPacket(Opcode.S2C_BATTLE_TURN, {
      battleId: 'btl:khac',
      roundNo: 5,
      actorId: MONSTER.id,
      turnMs: BATTLE_TURN_MS,
      turnEndsAt: Date.now(),
    });

    expect(battle.battle()?.battleId).toBe('btl:1');
    expect(battle.battle()?.roundNo).toBe(1);
  });

  it('S2C_BATTLE_RESULT ghi nhật ký và cập nhật máu của mọi người', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start());
    const result: BattleResult = {
      battleId: 'btl:1',
      roundNo: 1,
      actorId: 'p1',
      action: 'attack',
      events: [
        {
          kind: 'damage',
          actorId: 'p1',
          targetId: MONSTER.id,
          value: 15,
          text: 'Kakashi đánh thường gây 15 sát thương lên Chuột Đồng',
        },
      ],
      participants: [
        combatant({ id: MONSTER.id, kind: 'monster', name: 'Chuột Đồng', hp: 31 }),
        combatant(),
      ],
    };

    expect(battle.applyPacket(Opcode.S2C_BATTLE_RESULT, result)).toBe(true);
    expect(battle.log().map((event) => event.text)).toEqual([
      'Kakashi đánh thường gây 15 sát thương lên Chuột Đồng',
    ]);
    expect(battle.monster()?.hp).toBe(31);
  });

  it('nhật ký chỉ giữ số dòng gần nhất', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start());
    for (let index = 0; index < 80; index += 1) {
      battle.applyPacket(Opcode.S2C_BATTLE_RESULT, {
        battleId: 'btl:1',
        roundNo: 1,
        actorId: 'p1',
        action: 'attack',
        events: [{ kind: 'damage', actorId: 'p1', value: index, text: `dòng ${index}` }],
        participants: [MONSTER, combatant()],
      } satisfies BattleResult);
    }

    expect(battle.log()).toHaveLength(60);
    expect(battle.log().at(-1)?.text).toBe('dòng 79');
  });

  it('S2C_BATTLE_END lưu kết quả và phần thưởng, rồi đóng được bằng closeOutcome()', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start());
    const end: BattleEnd = {
      battleId: 'btl:1',
      outcome: 'victory',
      monsterName: 'Chuột Đồng',
      rewards: {
        exp: 45,
        yen: 12,
        level: 2,
        levelsGained: 1,
        drops: [{ itemId: 'item-da-vun', name: 'Đá Vụn', qty: 2 }],
      },
      participants: [
        combatant({ id: MONSTER.id, kind: 'monster', name: 'Chuột Đồng', hp: 0, alive: false }),
        combatant(),
      ],
    };

    expect(battle.applyPacket(Opcode.S2C_BATTLE_END, end)).toBe(true);
    expect(battle.outcome()?.outcome).toBe('victory');
    expect(battle.outcome()?.rewards?.drops[0]?.name).toBe('Đá Vụn');
    expect(battle.isMyTurn()).toBe(false);

    battle.closeOutcome();
    expect(battle.outcome()).toBeNull();
    expect(battle.battle()).toBeNull();
    expect(battle.log()).toEqual([]);
  });

  it('đồng hồ đếm ngược tính từ lúc nhận gói, không phải từ giờ của server', () => {
    vi.useFakeTimers();
    try {
      // `turnEndsAt` cố tình sai lệch (server lệch giờ) nhưng đồng hồ vẫn đếm từ lúc nhận gói.
      battle.applyPacket(
        Opcode.S2C_BATTLE_START,
        start({ turnEndsAt: Date.now() + 10 * BATTLE_TURN_MS }),
      );
      expect(battle.remainingMs()).toBe(BATTLE_TURN_MS);

      vi.advanceTimersByTime(5_000);
      expect(battle.remainingMs()).toBe(BATTLE_TURN_MS - 5_000);

      vi.advanceTimersByTime(60_000);
      expect(battle.remainingMs()).toBe(0);
    } finally {
      battle.reset();
      vi.useRealTimers();
    }
  });

  it('reset() xoá sạch trận khi mất kết nối', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start());
    battle.reset();

    expect(battle.battle()).toBeNull();
    expect(battle.log()).toEqual([]);
    expect(battle.outcome()).toBeNull();
  });

  it('bỏ qua gói không thuộc phần trận đấu', () => {
    expect(battle.applyPacket(Opcode.S2C_NOTIFY, { message: 'xin chào' })).toBe(false);
    expect(battle.applyPacket(Opcode.S2C_CHARACTER, {})).toBe(false);
  });

  it('giữ `mode` của S2C_BATTLE_START để giao diện biết đây là trận Lôi Đài', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start({ mode: 'arena' }));

    expect(battle.battle()?.mode).toBe('arena');
    expect(battle.isArena()).toBe(true);
  });

  it('S2C_ARENA_END đóng khung chiến đấu đang mở thay vì để trận treo', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start({ mode: 'arena' }));

    // Server không gửi `S2C_BATTLE_END` cho trận Lôi Đài: nếu client chờ gói đó thì trận treo mãi.
    expect(battle.applyPacket(Opcode.S2C_ARENA_END, arenaEnd())).toBe(true);
    expect(battle.battle()).toBeNull();
    expect(battle.inBattle()).toBe(false);
    expect(battle.isArena()).toBe(false);
  });

  it('S2C_ARENA_END của trận khác không đóng trận đang chạy', () => {
    battle.applyPacket(Opcode.S2C_BATTLE_START, start({ mode: 'arena' }));

    battle.applyPacket(Opcode.S2C_ARENA_END, arenaEnd({ battleId: 'btl:cu' }));

    expect(battle.battle()?.battleId).toBe('btl:1');
  });
});

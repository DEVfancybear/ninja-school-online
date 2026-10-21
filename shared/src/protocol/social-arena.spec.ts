import { describe, expect, it } from 'vitest';
import {
  ARENA_K_FACTOR,
  ARENA_MIN_LEVEL,
  ARENA_RATING_FLOOR,
  arenaDelta,
  arenaExpectedScore,
  LEADERBOARD_MAX_ENTRIES,
  PARTY_MAX_MEMBERS,
  WORLD_CHAT_MIN_INTERVAL_MS,
} from '../constants/index.js';
import { decodeClientPacket, decodeServerPacket } from './codec.js';
import { ErrorCode, ServerErrorSchema } from './packets.js';
import { Opcode } from './opcodes.js';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Hợp đồng M6 (bạn bè, tổ đội, chat nhiều kênh, Lôi Đài, bảng xếp hạng, hộp thư).
 *
 * Mỗi luật ở đây là thứ server và client cùng dựa vào; `docs/02-architecture/network-and-data.md`
 * §2f trích đúng các con số và tên mã trong bài kiểm thử này.
 */
describe('hợp đồng M6', () => {
  it('nâng protocol lên v6', () => {
    expect(PROTOCOL_VERSION).toBe(6);
  });

  it('mã gói xã hội nằm trong dải 0x07xx và Lôi Đài trong dải 0x08xx', () => {
    const social = [
      Opcode.C2S_FRIEND_REQUEST,
      Opcode.C2S_FRIEND_ACCEPT,
      Opcode.C2S_FRIEND_DECLINE,
      Opcode.C2S_FRIEND_REMOVE,
      Opcode.S2C_SOCIAL_UPDATE,
      Opcode.C2S_PARTY_INVITE,
      Opcode.C2S_PARTY_ACCEPT,
      Opcode.C2S_PARTY_DECLINE,
      Opcode.C2S_PARTY_LEAVE,
      Opcode.C2S_PARTY_KICK,
      Opcode.S2C_PARTY_UPDATE,
      Opcode.S2C_MAILS,
      Opcode.C2S_MAIL_CLAIM,
    ];
    const arena = [
      Opcode.C2S_ARENA_QUEUE,
      Opcode.C2S_ARENA_CANCEL,
      Opcode.S2C_ARENA_STATE,
      Opcode.S2C_ARENA_END,
      Opcode.C2S_LEADERBOARD,
      Opcode.S2C_LEADERBOARD,
    ];
    for (const op of social) {
      expect(op).toBeGreaterThanOrEqual(0x0701);
      expect(op).toBeLessThanOrEqual(0x07ff);
    }
    for (const op of arena) {
      expect(op).toBeGreaterThanOrEqual(0x0801);
      expect(op).toBeLessThanOrEqual(0x08ff);
    }
    const all = [...Object.values(Opcode)];
    expect(new Set(all).size).toBe(all.length);
  });

  describe('kênh chat', () => {
    it('bỏ trống kênh thì vẫn là kênh bản đồ như hợp đồng M2', () => {
      const decoded = decodeClientPacket(Opcode.C2S_CHAT, { text: 'chào cả làng' });
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.value).toMatchObject({ channel: 'map', text: 'chào cả làng' });
      }
    });

    it('tin riêng phải kèm người nhận', () => {
      expect(decodeClientPacket(Opcode.C2S_CHAT, { channel: 'private', text: 'ê' }).ok).toBe(false);
      const decoded = decodeClientPacket(Opcode.C2S_CHAT, {
        channel: 'private',
        text: 'ê',
        to: 'Bé Na',
      });
      expect(decoded.ok).toBe(true);
    });

    it('kênh khác không được kèm người nhận', () => {
      expect(
        decodeClientPacket(Opcode.C2S_CHAT, { channel: 'world', text: 'ê', to: 'Bé Na' }).ok,
      ).toBe(false);
    });

    it('kênh `system` không phải kênh client gửi lên được', () => {
      expect(decodeClientPacket(Opcode.C2S_CHAT, { channel: 'system', text: 'x' }).ok).toBe(false);
    });

    it('giới hạn chống spam của kênh thế giới chậm hơn kênh bản đồ', () => {
      expect(WORLD_CHAT_MIN_INTERVAL_MS).toBe(5_000);
    });
  });

  describe('bạn bè và tổ đội', () => {
    it('nhận gói lời mời kết bạn theo tên', () => {
      expect(decodeClientPacket(Opcode.C2S_FRIEND_REQUEST, { name: 'Bé Na' }).ok).toBe(true);
      expect(decodeClientPacket(Opcode.C2S_FRIEND_REQUEST, {}).ok).toBe(false);
      expect(decodeClientPacket(Opcode.C2S_FRIEND_REQUEST, { name: '' }).ok).toBe(false);
    });

    it('tóm tắt xã hội mang đủ ba danh sách và trần bạn', () => {
      const decoded = decodeServerPacket(Opcode.S2C_SOCIAL_UPDATE, {
        friends: [{ name: 'Bé Na', level: 4, school: 'haruna', class: 'dao', online: true }],
        incoming: [],
        outgoing: [],
      });
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.value).toMatchObject({ maxFriends: 50 });
      }
    });

    it('trạng thái đội một mình vẫn hợp lệ và tối đa 4 người', () => {
      const empty = decodeServerPacket(Opcode.S2C_PARTY_UPDATE, {
        partyId: null,
        leaderName: null,
        members: [],
        invites: [{ fromName: 'Bé Na', fromLevel: 3 }],
      });
      expect(empty.ok).toBe(true);
      if (empty.ok) {
        expect(empty.value).toMatchObject({ maxMembers: PARTY_MAX_MEMBERS });
      }
      expect(PARTY_MAX_MEMBERS).toBe(4);
    });

    it('gói rời đội không cần thân', () => {
      expect(decodeClientPacket(Opcode.C2S_PARTY_LEAVE, {}).ok).toBe(true);
    });

    it('tự mời/tự đuổi mình có mã lỗi riêng', () => {
      expect(ErrorCode.PARTY_SELF).toBe('party_self');
      expect(ErrorCode.FRIEND_SELF).toBe('friend_self');
    });
  });

  describe('hộp thư', () => {
    it('lỗi nhận thư khi túi đầy có mã được hợp đồng server chấp nhận', () => {
      expect(ErrorCode.INVENTORY_FULL).toBe('inventory_full');
      expect(
        ServerErrorSchema.safeParse({ code: ErrorCode.INVENTORY_FULL, message: 'Túi đồ đã đầy.' })
          .success,
      ).toBe(true);
    });

    it('mỗi thư có quà yên và danh sách món, thư đã nhận có cờ riêng', () => {
      const decoded = decodeServerPacket(Opcode.S2C_MAILS, {
        mails: [
          {
            id: 'mail-1',
            subject: 'Thư chào mừng',
            body: 'Chúc bạn chơi vui',
            yen: 100,
            items: [{ itemId: 'item-banh-bao', name: 'Bánh bao', qty: 1 }],
            claimed: false,
            sentAt: 1_760_000_000_000,
          },
        ],
      });
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.value).toMatchObject({ maxEntries: 20 });
      }
    });
  });

  describe('Lôi Đài', () => {
    it('trạng thái Lôi Đài có điểm, thắng, thua và số người đang chờ', () => {
      const decoded = decodeServerPacket(Opcode.S2C_ARENA_STATE, {
        queued: true,
        queueSize: 2,
        rating: 1_016,
        wins: 1,
        losses: 0,
      });
      expect(decoded.ok).toBe(true);
    });

    it('kết trận nói rõ thắng/thua của **người nhận** và điểm hai bên', () => {
      const decoded = decodeServerPacket(Opcode.S2C_ARENA_END, {
        battleId: 'arena-1',
        outcome: 'win',
        reason: 'defeat',
        ratingBefore: 1_000,
        ratingAfter: 1_016,
        ratingDelta: 16,
        opponentName: 'Bé Na',
        opponentRatingAfter: 984,
        wins: 1,
        losses: 0,
      });
      expect(decoded.ok).toBe(true);
    });

    it('bảng xếp hạng chỉ nhận hai loại bảng và giới hạn 20 dòng', () => {
      expect(decodeClientPacket(Opcode.C2S_LEADERBOARD, { board: 'level' }).ok).toBe(true);
      expect(decodeClientPacket(Opcode.C2S_LEADERBOARD, { board: 'arena' }).ok).toBe(true);
      expect(decodeClientPacket(Opcode.C2S_LEADERBOARD, { board: 'guild' }).ok).toBe(false);
      expect(
        decodeClientPacket(Opcode.C2S_LEADERBOARD, {
          board: 'level',
          limit: LEADERBOARD_MAX_ENTRIES + 1,
        }).ok,
      ).toBe(false);
      expect(LEADERBOARD_MAX_ENTRIES).toBe(20);
    });

    it('bảng cấp độ không cần điểm Lôi Đài', () => {
      const decoded = decodeServerPacket(Opcode.S2C_LEADERBOARD, {
        board: 'level',
        entries: [{ rank: 1, name: 'Bé Na', level: 7, school: 'ookaza', class: 'kunai' }],
      });
      expect(decoded.ok).toBe(true);
    });

    it('trận Lôi Đài dùng gói bắt đầu trận chung và mang cờ `mode`', () => {
      const payload = {
        battleId: 'arena-1',
        roundNo: 1,
        participants: [
          {
            id: 'a',
            kind: 'player',
            name: 'A',
            level: 3,
            hp: 10,
            maxHp: 10,
            mp: 0,
            maxMp: 0,
            attack: 1,
            defense: 0,
            speed: 1,
            alive: true,
          },
          {
            id: 'b',
            kind: 'player',
            name: 'B',
            level: 3,
            hp: 10,
            maxHp: 10,
            mp: 0,
            maxMp: 0,
            attack: 1,
            defense: 0,
            speed: 1,
            alive: true,
          },
        ],
        actorId: 'a',
        turnMs: 30_000,
        turnEndsAt: 0,
        mode: 'arena',
      };
      const decoded = decodeServerPacket(Opcode.S2C_BATTLE_START, payload);
      expect(decoded.ok).toBe(true);
      // Trận PvE cũ không gửi `mode` vẫn hợp lệ và mặc định là `pve`.
      const legacy: Record<string, unknown> = { ...payload };
      delete legacy.mode;
      const pve = decodeServerPacket(Opcode.S2C_BATTLE_START, legacy);
      expect(pve.ok).toBe(true);
      if (pve.ok) {
        expect(pve.value).toMatchObject({ mode: 'pve' });
      }
    });
  });

  describe('công thức điểm Lôi Đài', () => {
    it('hai bên ngang điểm thì mỗi bên có 50% cơ hội', () => {
      expect(arenaExpectedScore(1_000, 1_000)).toBeCloseTo(0.5, 10);
      expect(arenaDelta(1_000, 1_000, true)).toBe(16);
      expect(arenaDelta(1_000, 1_000, false)).toBe(-16);
    });

    it('thắng người mạnh hơn được nhiều điểm hơn thắng người yếu hơn', () => {
      const againstStrong = arenaDelta(1_000, 1_200, true);
      const againstWeak = arenaDelta(1_000, 800, true);
      expect(againstStrong).toBeGreaterThan(againstWeak);
      expect(againstStrong + againstWeak).toBeCloseTo(ARENA_K_FACTOR, 0);
    });

    it('thua người yếu hơn mất nhiều hơn thua người mạnh hơn', () => {
      expect(Math.abs(arenaDelta(1_000, 800, false))).toBeGreaterThan(
        Math.abs(arenaDelta(1_000, 1_200, false)),
      );
    });

    it('Elo có thể trừ hơn K/2 khi người điểm cao thua và luôn giữ sàn điểm', () => {
      expect(arenaDelta(1_200, 1_000, false)).toBe(-24);
      expect(arenaDelta(ARENA_RATING_FLOOR, 100, false)).toBe(0);
      expect(arenaDelta(ARENA_RATING_FLOOR + 3, 100, false)).toBe(-3);
    });

    it('cấp tối thiểu vào Lôi Đài là 3', () => {
      expect(ARENA_MIN_LEVEL).toBe(3);
    });
  });
});

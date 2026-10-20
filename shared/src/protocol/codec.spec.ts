import { describe, expect, it } from 'vitest';
import { SELL_PRICE_RATIO } from '../constants/equipment.js';
import { decodeClientPacket, decodeEnvelope, decodeServerPacket, encodePacket } from './codec.js';
import { Opcode } from './opcodes.js';
import { NpcDialogSchema, UpgradeResultSchema } from './packets.js';
import { PROTOCOL_VERSION } from './version.js';

describe('encodePacket / decodeEnvelope', () => {
  it('đi vòng qua lại vẫn giữ nguyên mã gói và phần thân', () => {
    const raw = encodePacket(Opcode.C2S_MOVE, { x: 120, y: 64 }, 7);
    const decoded = decodeEnvelope(raw);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.op).toBe(Opcode.C2S_MOVE);
      expect(decoded.value.seq).toBe(7);
      expect(decoded.value.payload).toEqual({ x: 120, y: 64 });
    }
  });

  it('từ chối dữ liệu không phải JSON', () => {
    const decoded = decodeEnvelope('khong-phai-json');
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toContain('JSON');
    }
  });

  it('từ chối khung thiếu mã gói', () => {
    expect(decodeEnvelope('{"seq":1}').ok).toBe(false);
  });

  it('điền mặc định cho seq và payload khi thiếu', () => {
    const decoded = decodeEnvelope('{"op":260}');
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.seq).toBe(0);
      expect(decoded.value.payload).toEqual({});
    }
  });
});

describe('decodeClientPacket', () => {
  it('chấp nhận gói HELLO hợp lệ', () => {
    const result = decodeClientPacket(Opcode.C2S_HELLO, {
      token: 'abc',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { clientVersion: string }).clientVersion).toBe('dev');
    }
  });

  it('chấp nhận characterId khi client chọn nhân vật', () => {
    const result = decodeClientPacket(Opcode.C2S_HELLO, {
      token: 'abc',
      protocolVersion: PROTOCOL_VERSION,
      characterId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { characterId: string }).characterId).toBe(
        '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      );
    }
  });

  it('từ chối characterId không phải uuid', () => {
    expect(
      decodeClientPacket(Opcode.C2S_HELLO, {
        token: 'abc',
        protocolVersion: PROTOCOL_VERSION,
        characterId: 'khong-phai-uuid',
      }).ok,
    ).toBe(false);
  });

  it('từ chối gói MOVE thiếu toạ độ, và nêu rõ trường sai', () => {
    const result = decodeClientPacket(Opcode.C2S_MOVE, { x: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('y');
    }
  });

  it('từ chối gói chat dài quá giới hạn', () => {
    const result = decodeClientPacket(Opcode.C2S_CHAT, {
      channel: 'map',
      text: 'a'.repeat(500),
    });
    expect(result.ok).toBe(false);
  });

  it('từ chối mã gói mà client không được gửi (gói của server)', () => {
    const result = decodeClientPacket(Opcode.S2C_CHAT, { text: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('không hỗ trợ');
      // Tên gói phải hiện trong thông báo để dễ gỡ lỗi.
      expect(result.reason).toContain('S2C_CHAT');
    }
  });
});

describe('decodeServerPacket', () => {
  it('chấp nhận bản tin chat hợp lệ', () => {
    const result = decodeServerPacket(Opcode.S2C_CHAT, {
      channel: 'map',
      fromId: 'char-1',
      fromName: 'HoaLong',
      text: 'xin chào',
      at: 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
  });

  it('từ chối hướng đi không hợp lệ trong gói di chuyển', () => {
    const result = decodeServerPacket(Opcode.S2C_ENTITY_MOVE, {
      moves: [{ id: 'char-1', x: 1, y: 2, facing: 'lên-trên' }],
    });
    expect(result.ok).toBe(false);
  });

  it('từ chối mảng moves rỗng', () => {
    expect(decodeServerPacket(Opcode.S2C_ENTITY_MOVE, { moves: [] }).ok).toBe(false);
  });

  it('chấp nhận gói bắt đầu trận với hai người tham gia', () => {
    const result = decodeServerPacket(Opcode.S2C_BATTLE_START, {
      battleId: 'btl:lang-khoi-nguon:mob-0',
      roundNo: 1,
      actorId: 'char-1',
      turnMs: 30_000,
      turnEndsAt: 1_700_000_030_000,
      participants: [combatant('char-1', 'player'), combatant('mob-0', 'monster')],
    });
    expect(result.ok).toBe(true);
  });

  it('từ chối gói bắt đầu trận khi chỉ có một người tham gia', () => {
    const result = decodeServerPacket(Opcode.S2C_BATTLE_START, {
      battleId: 'btl:1',
      roundNo: 1,
      actorId: 'char-1',
      turnMs: 30_000,
      turnEndsAt: 1_700_000_030_000,
      participants: [combatant('char-1', 'player')],
    });
    expect(result.ok).toBe(false);
  });

  it('từ chối hành động dùng chiêu mà thiếu skillId', () => {
    const result = decodeClientPacket(Opcode.C2S_BATTLE_ACTION, {
      battleId: 'btl:1',
      action: 'skill',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('skillId');
    }
  });

  it('từ chối hành động dùng vật phẩm mà thiếu itemId', () => {
    expect(
      decodeClientPacket(Opcode.C2S_BATTLE_ACTION, { battleId: 'btl:1', action: 'item' }).ok,
    ).toBe(false);
  });

  it('chấp nhận đòn đánh thường có mục tiêu', () => {
    const result = decodeClientPacket(Opcode.C2S_BATTLE_ACTION, {
      battleId: 'btl:1',
      action: 'attack',
      targetId: 'mob-0',
    });
    expect(result.ok).toBe(true);
  });
});

/** Người tham gia trận tối thiểu, đủ trường để `CombatantSchema` nhận. */
function combatant(id: string, kind: 'player' | 'monster') {
  return {
    id,
    kind,
    name: id,
    level: 1,
    hp: 10,
    maxHp: 10,
    mp: 0,
    maxMp: 0,
    attack: 1,
    defense: 1,
    speed: 1,
    alive: true,
  };
}

describe('PROTOCOL_VERSION', () => {
  it('là 6 ở cột mốc M6 (thêm xã hội, Lôi Đài, bảng xếp hạng và hộp thư)', () => {
    expect(PROTOCOL_VERSION).toBe(6);
  });
});

describe('gói tin M5 (nhiệm vụ)', () => {
  it('chấp nhận lệnh nhận nhiệm vụ theo questId', () => {
    const result = decodeClientPacket(Opcode.C2S_QUEST_ACCEPT, { questId: 'quest-chao-lang' });
    expect(result.ok).toBe(true);
  });

  it('chấp nhận lệnh trả nhiệm vụ theo questId', () => {
    const result = decodeClientPacket(Opcode.C2S_QUEST_COMPLETE, { questId: 'quest-chao-lang' });
    expect(result.ok).toBe(true);
  });

  it('từ chối lệnh nhận nhiệm vụ thiếu questId', () => {
    expect(decodeClientPacket(Opcode.C2S_QUEST_ACCEPT, {}).ok).toBe(false);
  });

  it('chấp nhận lựa chọn trong cây hội thoại', () => {
    const result = decodeClientPacket(Opcode.C2S_NPC_TALK, {
      npcId: 'npc-su-phu',
      optionId: 'xin-bai-su',
    });
    expect(result.ok).toBe(true);
  });
});

describe('gói tin M4 (trang bị, shop, cường hóa)', () => {
  it('chấp nhận lệnh mặc trang bị theo itemId', () => {
    expect(decodeClientPacket(Opcode.C2S_EQUIP, { itemId: 'item-kiem-go' }).ok).toBe(true);
  });

  it('từ chối lệnh tháo khi ô không hợp lệ', () => {
    expect(decodeClientPacket(Opcode.C2S_UNEQUIP, { slot: 'chan' }).ok).toBe(false);
  });

  it('chấp nhận lệnh mua không kèm số lượng và điền mặc định 1', () => {
    const result = decodeClientPacket(Opcode.C2S_SHOP_BUY, { itemId: 'item-banh-bao' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ itemId: 'item-banh-bao', quantity: 1 });
    }
  });

  it('từ chối số lượng mua bằng 0', () => {
    expect(
      decodeClientPacket(Opcode.C2S_SHOP_BUY, { itemId: 'item-banh-bao', quantity: 0 }).ok,
    ).toBe(false);
  });

  it('điền mặc định cho quầy hàng và món thiếu trường trong hội thoại NPC', () => {
    const dialog = NpcDialogSchema.parse({
      npcId: 'npc-thay-do',
      npcName: 'Thầy Đồ',
      lines: [{ speaker: 'Thầy Đồ', text: 'chào' }],
      shop: {
        entries: [
          {
            itemId: 'item-ao-vai',
            name: 'Áo Vải',
            kind: 'armor',
            price: 150,
            sellPrice: 60,
            levelRequired: 1,
          },
        ],
      },
    });

    expect(dialog.shop?.sellRatio).toBe(SELL_PRICE_RATIO);
    expect(dialog.shop?.entries[0]?.slot).toBeNull();
    expect(dialog.shop?.entries[0]?.stats.hp).toBe(0);
  });

  it('NPC thường có shop là null', () => {
    const dialog = NpcDialogSchema.parse({
      npcId: 'npc-thay-hieu-truong',
      npcName: 'Thầy Hiệu Trưởng',
      lines: [{ speaker: 'Thầy Hiệu Trưởng', text: 'chào' }],
    });
    expect(dialog.shop).toBeNull();
  });

  it('chấp nhận kết quả cường hóa thất bại (giữ nguyên cấp)', () => {
    const result = UpgradeResultSchema.parse({
      itemId: 'item-kiem-go',
      name: 'Kiếm Gỗ',
      success: false,
      upgradeLevel: 2,
      previousLevel: 2,
      successRate: 0.75,
      yenCost: 260,
      materialQty: 1,
      message: 'cường hóa thất bại, món vẫn ở +2',
    });
    expect(result.upgradeLevel).toBe(result.previousLevel);
  });
});

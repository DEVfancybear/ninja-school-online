import { describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeEnvelope, decodeServerPacket, encodePacket } from './codec.js';
import { Opcode } from './opcodes.js';
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
});

describe('PROTOCOL_VERSION', () => {
  it('là 2 ở cột mốc M2 (đã thêm khung gói tin WebSocket)', () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });
});

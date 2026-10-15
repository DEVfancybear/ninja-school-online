import { describe, expect, it } from 'vitest';
import {
  AccountSchema,
  CreateCharacterRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  SCHOOL_CLASSES,
} from '../index.js';

describe('RegisterRequestSchema', () => {
  it('chấp nhận tên đăng nhập và mật khẩu hợp lệ', () => {
    const value = { username: 'ninja_01', password: 'matkhau123' };
    expect(RegisterRequestSchema.parse(value)).toEqual(value);
  });

  it('chuẩn hoá email thành chuỗi rỗng khi không gửi', () => {
    const parsed = RegisterRequestSchema.parse({ username: 'ninja_01', password: 'matkhau123' });
    expect(parsed.email).toBeUndefined();
  });

  it('từ chối tên đăng nhập có chữ hoa', () => {
    expect(() => RegisterRequestSchema.parse({ username: 'Ninja01', password: 'matkhau123' })).toThrow();
  });

  it('từ chối mật khẩu quá ngắn', () => {
    expect(() => RegisterRequestSchema.parse({ username: 'ninja_01', password: 'ngan' })).toThrow();
  });

  it('từ chối email sai định dạng', () => {
    expect(() =>
      RegisterRequestSchema.parse({ username: 'ninja_01', password: 'matkhau123', email: 'khong-phai-email' }),
    ).toThrow();
  });
});

describe('LoginRequestSchema', () => {
  it('chỉ cần mật khẩu không rỗng (không áp quy tắc độ mạnh)', () => {
    expect(LoginRequestSchema.parse({ username: 'ninja_01', password: 'x' }).password).toBe('x');
  });

  it('từ chối mật khẩu rỗng', () => {
    expect(() => LoginRequestSchema.parse({ username: 'ninja_01', password: '' })).toThrow();
  });
});

describe('CreateCharacterRequestSchema', () => {
  it('chấp nhận tên tiếng Việt có dấu', () => {
    const value = { name: 'HỏaLong', school: 'haruna', class: 'dao' };
    expect(CreateCharacterRequestSchema.parse(value)).toEqual(value);
  });

  it('từ chối phái không thuộc trường đã chọn', () => {
    const result = CreateCharacterRequestSchema.safeParse({ name: 'HoaLong', school: 'haruna', class: 'kunai' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['class']);
  });

  it('từ chối tên có dấu cách', () => {
    expect(() =>
      CreateCharacterRequestSchema.parse({ name: 'Hoa Long', school: 'ookaza', class: 'cung' }),
    ).toThrow();
  });

  it('từ chối tên ngắn hơn 3 ký tự', () => {
    expect(() => CreateCharacterRequestSchema.parse({ name: 'ab', school: 'ookaza', class: 'cung' })).toThrow();
  });
});

describe('AccountSchema', () => {
  it('từ chối thời gian không phải ISO', () => {
    expect(() => AccountSchema.parse({ id: 'khong-phai-uuid', username: 'a', createdAt: 'hom qua' })).toThrow();
  });

  it('chấp nhận uuid và thời gian ISO', () => {
    const parsed = AccountSchema.parse({
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      username: 'ninja_01',
      createdAt: '2026-10-15T04:00:00.000Z',
    });
    expect(parsed.username).toBe('ninja_01');
  });
});

describe('SCHOOL_CLASSES', () => {
  it('mỗi trường có đúng hai phái', () => {
    for (const [, classes] of Object.entries(SCHOOL_CLASSES)) {
      expect(classes).toHaveLength(2);
    }
  });
});

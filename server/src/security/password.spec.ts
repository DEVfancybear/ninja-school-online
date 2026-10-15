import { describe, expect, it } from 'vitest';
import { argon2PasswordHasher } from './password.js';

describe('argon2PasswordHasher', () => {
  it('sinh hash Argon2id với tham số đúng khuyến nghị OWASP', async () => {
    const hash = await argon2PasswordHasher.hash('matkhau123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
  });

  it('hai lần băm cùng mật khẩu cho ra hash khác nhau (có salt riêng)', async () => {
    const first = await argon2PasswordHasher.hash('matkhau123');
    const second = await argon2PasswordHasher.hash('matkhau123');
    expect(first).not.toBe(second);
  });

  it('kiểm tra đúng mật khẩu thì trả true, sai thì trả false', async () => {
    const hash = await argon2PasswordHasher.hash('matkhau123');
    await expect(argon2PasswordHasher.verify(hash, 'matkhau123')).resolves.toBe(true);
    await expect(argon2PasswordHasher.verify(hash, 'matkhau124')).resolves.toBe(false);
  });

  it('chuỗi hash hỏng thì trả false thay vì ném lỗi', async () => {
    await expect(argon2PasswordHasher.verify('khong-phai-hash', 'matkhau123')).resolves.toBe(false);
  });
});

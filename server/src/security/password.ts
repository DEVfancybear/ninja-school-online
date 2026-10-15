import { hash, verify } from '@node-rs/argon2';

/**
 * Không truyền tham số để dùng mặc định của thư viện: Argon2id, m = 19456 KiB (19 MiB),
 * t = 2, p = 1 — đúng khuyến nghị tối thiểu của OWASP.
 *
 * Lý do không truyền `algorithm: Algorithm.Argon2id`: `Algorithm` trong @node-rs/argon2 là
 * `const enum` nên không dùng được khi bật `verbatimModuleSyntax`. Thay vào đó,
 * `password.spec.ts` kiểm chứng trực tiếp chuỗi hash sinh ra có dạng `$argon2id$m=19456,t=2,p=1$`.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hashValue: string, password: string): Promise<boolean>;
}

export const argon2PasswordHasher: PasswordHasher = {
  hash: (password) => hash(password),
  verify: async (hashValue, password) => {
    try {
      return await verify(hashValue, password);
    } catch {
      // Chuỗi hash hỏng hoặc sai định dạng: coi như không khớp, không làm sập yêu cầu.
      return false;
    }
  },
};

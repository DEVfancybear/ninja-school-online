import { eq, sql } from 'drizzle-orm';
import {
  type Account,
  type AuthSession,
  type LoginRequest,
  type RegisterRequest,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { accounts } from '../../db/schema.js';
import { conflictError, unauthorizedError } from '../../errors.js';
import type { PasswordHasher } from '../../security/password.js';
import type { TokenService } from '../../security/tokens.js';

type AccountRow = typeof accounts.$inferSelect;

export interface AccountServiceOptions {
  db: Db;
  hasher: PasswordHasher;
  tokens: TokenService;
  /** Ký access token cho tài khoản; tách khỏi Fastify để kiểm thử được. */
  signAccessToken: (payload: { sub: string; username: string }) => string;
}

/** Chuyển hàng trong DB thành dữ liệu trả cho client (không bao giờ lộ hash mật khẩu). */
export function toAccountDto(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
  };
}

export class AccountService {
  constructor(private readonly options: AccountServiceOptions) {}

  /** Đăng ký tài khoản mới và trả về phiên đăng nhập ngay (không cần đăng nhập lại). */
  async register(input: RegisterRequest): Promise<AuthSession> {
    const passwordHash = await this.options.hasher.hash(input.password);

    let row: AccountRow;
    try {
      const inserted = await this.options.db
        .insert(accounts)
        .values({
          username: input.username,
          passwordHash,
          email: input.email ?? null,
        })
        .returning();
      row = inserted[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflictError('tên đăng nhập này đã được dùng, hãy chọn tên khác');
      }
      throw error;
    }

    return this.createSession(row);
  }

  /** Đăng nhập bằng tên đăng nhập và mật khẩu. */
  async login(input: LoginRequest): Promise<AuthSession> {
    const [row] = await this.options.db
      .select()
      .from(accounts)
      .where(sql`lower(${accounts.username}) = lower(${input.username})`);

    if (!row) {
      // Vẫn băm mật khẩu để thời gian phản hồi không tiết lộ tên đăng nhập có tồn tại hay không.
      await this.options.hasher.hash(input.password);
      throw invalidCredentials();
    }

    const matches = await this.options.hasher.verify(row.passwordHash, input.password);
    if (!matches) {
      throw invalidCredentials();
    }

    if (row.status !== 'active') {
      throw unauthorizedError('tài khoản đang bị khoá');
    }

    return this.createSession(row);
  }

  /** Làm mới phiên: xoay refresh token và cấp access token mới. */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const rotated = await this.options.tokens.rotateRefreshToken(refreshToken);
    const account = await this.findById(rotated.accountId);
    if (!account) {
      throw unauthorizedError('tài khoản không còn tồn tại');
    }
    return {
      account: toAccountDto(account),
      accessToken: this.options.signAccessToken({ sub: account.id, username: account.username }),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.options.tokens.revokeRefreshToken(refreshToken);
  }

  async findById(id: string): Promise<AccountRow | undefined> {
    const [row] = await this.options.db.select().from(accounts).where(eq(accounts.id, id));
    return row;
  }

  private async createSession(row: AccountRow): Promise<AuthSession> {
    const refreshToken = await this.options.tokens.issueRefreshToken(row.id);
    return {
      account: toAccountDto(row),
      accessToken: this.options.signAccessToken({ sub: row.id, username: row.username }),
      refreshToken,
    };
  }
}

function invalidCredentials() {
  // Một thông báo duy nhất cho cả hai trường hợp để không tiết lộ tài khoản có tồn tại.
  return unauthorizedError('tên đăng nhập hoặc mật khẩu không đúng');
}

/**
 * PostgreSQL báo vi phạm ràng buộc duy nhất bằng mã 23505.
 * Drizzle bọc lỗi gốc vào lớp ngoài (DrizzleQueryError) nên phải đi theo chuỗi `cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';
import { unauthorizedError } from '../errors.js';

export interface AccessTokenPayload {
  sub: string;
  username: string;
}

/** Ký access token (JWT). Tách thành interface để kiểm thử không cần Fastify. */
export interface JwtSigner {
  sign(payload: AccessTokenPayload): string;
}

const REFRESH_TOKEN_BYTES = 32;

/** Băm refresh token trước khi lưu: rò rỉ bảng cũng không dùng lại được token. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export interface TokenServiceOptions {
  refreshTtlDays: number;
  now?: () => Date;
}

/**
 * Cấp và xoay refresh token (rotation): mỗi lần làm mới thì token cũ bị thu hồi
 * và một token mới được phát hành, nên token bị đánh cắp chỉ dùng được một lần.
 */
export class TokenService {
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    private readonly options: TokenServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async issueRefreshToken(accountId: string): Promise<string> {
    const token = generateRefreshToken();
    const expiresAt = new Date(
      this.now().getTime() + this.options.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.db.insert(refreshTokens).values({
      accountId,
      tokenHash: hashRefreshToken(token),
      expiresAt,
    });
    return token;
  }

  /** Kiểm tra refresh token còn hiệu lực, thu hồi nó và phát hành token mới. */
  async rotateRefreshToken(token: string): Promise<{ accountId: string; refreshToken: string }> {
    const tokenHash = hashRefreshToken(token);
    const [row] = await this.db
      .update(refreshTokens)
      .set({ revokedAt: this.now() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, this.now()),
        ),
      )
      .returning({ accountId: refreshTokens.accountId });

    if (!row) {
      throw unauthorizedError('phiên đăng nhập đã hết hạn, hãy đăng nhập lại');
    }

    return { accountId: row.accountId, refreshToken: await this.issueRefreshToken(row.accountId) };
  }

  /** Thu hồi một refresh token (đăng xuất). Không báo lỗi nếu token không tồn tại. */
  async revokeRefreshToken(token: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: this.now() })
      .where(
        and(eq(refreshTokens.tokenHash, hashRefreshToken(token)), isNull(refreshTokens.revokedAt)),
      );
  }
}

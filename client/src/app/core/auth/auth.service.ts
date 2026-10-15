import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AccountSchema,
  ApiErrorCode,
  AuthSessionSchema,
  AuthTokensSchema,
  type Account,
  type AuthSession,
  type LoginRequest,
  type RegisterRequest,
} from '@ninja/shared';
import { isApiRequestError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { LOGIN_PATH, LOGOUT_PATH, ME_PATH, REFRESH_PATH, REGISTER_PATH } from '../api/endpoints';
import { EMPTY_RESPONSE, fieldSchema } from '../api/schema';

/** Khoá `localStorage` giữ phiên đăng nhập. */
export const ACCESS_TOKEN_KEY = 'ninja.accessToken';
export const REFRESH_TOKEN_KEY = 'ninja.refreshToken';

function readStoredToken(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư): coi như chưa có phiên.
    return null;
  }
}

function writeStoredToken(key: string, value: string | null): void {
  try {
    if (value === null) {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, value);
    }
  } catch {
    // Không ghi được: phiên chỉ sống trong bộ nhớ của tab hiện tại.
  }
}

/**
 * Phiên đăng nhập của người chơi: giữ token + tài khoản trong signals, lưu token vào
 * `localStorage` và tự khôi phục phiên khi tải lại trang.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);

  private readonly accountSignal = signal<Account | null>(null);
  private readonly accessTokenSignal = signal<string | null>(readStoredToken(ACCESS_TOKEN_KEY));
  private readonly refreshTokenSignal = signal<string | null>(readStoredToken(REFRESH_TOKEN_KEY));
  private pendingRestore?: Promise<Account | null>;

  readonly account = this.accountSignal.asReadonly();
  readonly accessToken = this.accessTokenSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.accountSignal() !== null);

  async register(input: RegisterRequest): Promise<Account> {
    const session = await this.api.post(REGISTER_PATH, input, AuthSessionSchema);
    this.applySession(session);
    return session.account;
  }

  async login(input: LoginRequest): Promise<Account> {
    const session = await this.api.post(LOGIN_PATH, input, AuthSessionSchema);
    this.applySession(session);
    return session.account;
  }

  /**
   * Đăng xuất: yêu cầu server **thu hồi refresh token** rồi mới xoá phiên ở client.
   *
   * Nếu không gọi được server (mất mạng, server đang bảo trì) thì vẫn xoá phiên ở client —
   * người chơi không thể bị giữ trong trạng thái đã đăng nhập chỉ vì lỗi mạng — nhưng khi đó
   * refresh token cũ chỉ hết hiệu lực theo thời hạn của nó.
   */
  async logout(): Promise<void> {
    const refreshToken = this.refreshTokenSignal();
    try {
      if (refreshToken) {
        await this.api.post(LOGOUT_PATH, { refreshToken }, EMPTY_RESPONSE);
      }
    } catch {
      // Bỏ qua: việc quan trọng là phiên ở client được xoá.
    } finally {
      this.clearSession();
    }
  }

  /**
   * Đăng nhập lại bằng token đã lưu: gọi `/api/auth/me`; nếu access token hết hạn thì
   * đổi refresh token lấy cặp token mới rồi thử lại. Gọi song song nhiều lần chỉ tốn một yêu cầu.
   */
  restoreSession(): Promise<Account | null> {
    const current = this.accountSignal();
    if (current) {
      return Promise.resolve(current);
    }
    this.pendingRestore ??= this.loadSession().finally(() => {
      this.pendingRestore = undefined;
    });
    return this.pendingRestore;
  }

  private async loadSession(): Promise<Account | null> {
    const token = this.accessTokenSignal();
    if (!token) {
      return null;
    }

    try {
      return await this.fetchAccount(token);
    } catch (error) {
      const expired = isApiRequestError(error) && error.code === ApiErrorCode.UNAUTHORIZED;
      if (expired && (await this.refreshTokens())) {
        const refreshed = this.accessTokenSignal();
        if (refreshed) {
          try {
            return await this.fetchAccount(refreshed);
          } catch {
            // Token mới vẫn không dùng được: coi như phiên đã hết.
          }
        }
      }
      this.clearSession();
      return null;
    }
  }

  private async fetchAccount(token: string): Promise<Account> {
    const account = await this.api.get(ME_PATH, fieldSchema('account', AccountSchema), token);
    this.accountSignal.set(account);
    return account;
  }

  private async refreshTokens(): Promise<boolean> {
    const refreshToken = this.refreshTokenSignal();
    if (!refreshToken) {
      return false;
    }
    try {
      const tokens = await this.api.post(REFRESH_PATH, { refreshToken }, AuthTokensSchema);
      this.setTokens(tokens.accessToken, tokens.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private applySession(session: AuthSession): void {
    this.setTokens(session.accessToken, session.refreshToken);
    this.accountSignal.set(session.account);
  }

  private clearSession(): void {
    this.setTokens(null, null);
    this.accountSignal.set(null);
  }

  private setTokens(accessToken: string | null, refreshToken: string | null): void {
    this.accessTokenSignal.set(accessToken);
    this.refreshTokenSignal.set(refreshToken);
    writeStoredToken(ACCESS_TOKEN_KEY, accessToken);
    writeStoredToken(REFRESH_TOKEN_KEY, refreshToken);
  }
}

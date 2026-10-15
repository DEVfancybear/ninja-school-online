import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiRequestError } from '../api/api-error';
import { ACCESS_TOKEN_KEY, AuthService, REFRESH_TOKEN_KEY } from './auth.service';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'ninja_test',
  createdAt: '2026-10-15T10:00:00.000Z',
};

const SESSION = { accessToken: 'access-1', refreshToken: 'refresh-1', account: ACCOUNT };
const REFRESHED = { accessToken: 'access-2', refreshToken: 'refresh-2' };

/** Chờ hết các microtask mà service sắp chạy sau khi flush một yêu cầu. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuthService', () => {
  // `createService()` gán controller của bài kiểm hiện tại vào biến này.
  let http: HttpTestingController;

  function createService(): AuthService {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('đăng nhập: lưu token vào localStorage và đặt tài khoản hiện tại', async () => {
    const auth = createService();

    const promise = auth.login({ username: 'ninja_test', password: 'matkhau123' });
    const request = http.expectOne({ method: 'POST', url: '/api/auth/login' });
    expect(request.request.body).toEqual({ username: 'ninja_test', password: 'matkhau123' });
    request.flush(SESSION);

    await expect(promise).resolves.toEqual(ACCOUNT);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.account()).toEqual(ACCOUNT);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-1');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('đăng ký: gửi email khi có và lưu phiên', async () => {
    const auth = createService();

    const promise = auth.register({
      username: 'ninja_test',
      password: 'matkhau123',
      email: 'ninja@example.com',
    });
    const request = http.expectOne({ method: 'POST', url: '/api/auth/register' });
    expect(request.request.body).toEqual({
      username: 'ninja_test',
      password: 'matkhau123',
      email: 'ninja@example.com',
    });
    request.flush(SESSION, { status: 201, statusText: 'Created' });

    await expect(promise).resolves.toEqual(ACCOUNT);
    expect(auth.isAuthenticated()).toBe(true);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-1');
  });

  it('đăng nhập thất bại: ném lỗi có mã và không lưu phiên', async () => {
    const auth = createService();

    const promise = auth.login({ username: 'ninja_test', password: 'sai-mat-khau' });
    const request = http.expectOne({ method: 'POST', url: '/api/auth/login' });
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
      message: 'tên đăng nhập hoặc mật khẩu không đúng',
    });
    request.flush(
      { error: 'unauthorized', message: 'tên đăng nhập hoặc mật khẩu không đúng' },
      { status: 401, statusText: 'Unauthorized' },
    );

    await assertion;
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('đăng xuất: xoá tài khoản và token đã lưu', async () => {
    const auth = createService();
    const login = auth.login({ username: 'ninja_test', password: 'matkhau123' });
    http.expectOne('/api/auth/login').flush(SESSION);
    await login;

    auth.logout();

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.account()).toBeNull();
    expect(auth.accessToken()).toBeNull();
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('restoreSession: chưa có token thì không gọi máy chủ', async () => {
    const auth = createService();

    await expect(auth.restoreSession()).resolves.toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    http.expectNone('/api/auth/me');
  });

  it('restoreSession: dùng access token đã lưu để lấy lại tài khoản', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-old');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-old');
    const auth = createService();

    const promise = auth.restoreSession();
    const request = http.expectOne('/api/auth/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-old');
    request.flush({ account: ACCOUNT });

    await expect(promise).resolves.toEqual(ACCOUNT);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('restoreSession: access token hết hạn thì đổi refresh token rồi thử lại', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-old');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-old');
    const auth = createService();

    const promise = auth.restoreSession();
    http
      .expectOne('/api/auth/me')
      .flush(
        { error: 'unauthorized', message: 'access token hết hạn' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await settle();

    const refresh = http.expectOne({ method: 'POST', url: '/api/auth/refresh' });
    expect(refresh.request.body).toEqual({ refreshToken: 'refresh-old' });
    refresh.flush(REFRESHED);

    await settle();

    const retry = http.expectOne({ method: 'GET', url: '/api/auth/me' });
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-2');
    retry.flush({ account: ACCOUNT });

    await expect(promise).resolves.toEqual(ACCOUNT);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-2');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-2');
  });

  it('restoreSession: refresh token không dùng được thì xoá phiên đã lưu', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-old');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-old');
    const auth = createService();

    const promise = auth.restoreSession();
    http
      .expectOne('/api/auth/me')
      .flush(
        { error: 'unauthorized', message: 'access token hết hạn' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await settle();

    http
      .expectOne('/api/auth/refresh')
      .flush(
        { error: 'unauthorized', message: 'refresh token hết hạn' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(promise).resolves.toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('restoreSession: gọi song song chỉ tạo một yêu cầu', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-old');
    const auth = createService();

    const first = auth.restoreSession();
    const second = auth.restoreSession();
    http.expectOne('/api/auth/me').flush({ account: ACCOUNT });

    await expect(Promise.all([first, second])).resolves.toEqual([ACCOUNT, ACCOUNT]);
    http.expectNone('/api/auth/me');
  });

  it('ApiRequestError giữ đúng mã lỗi mà server trả về', () => {
    const error = new ApiRequestError('tên đăng nhập đã tồn tại', 'conflict', 409);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiRequestError');
    expect(error.code).toBe('conflict');
    expect(error.status).toBe(409);
  });
});

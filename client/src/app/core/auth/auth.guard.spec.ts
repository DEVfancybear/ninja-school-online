import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  UrlTree,
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { ACCESS_TOKEN_KEY, AuthService } from './auth.service';
import { authGuard } from './auth.guard';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'ninja_test',
  createdAt: '2026-10-15T10:00:00.000Z',
};

const SESSION = { accessToken: 'access-1', refreshToken: 'refresh-1', account: ACCOUNT };

const ROUTE = {} as ActivatedRouteSnapshot;
const STATE = { url: '/characters' } as RouterStateSnapshot;

describe('authGuard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('cho qua khi đã đăng nhập', async () => {
    const auth = TestBed.inject(AuthService);
    const login = auth.login({ username: 'ninja_test', password: 'matkhau123' });
    http.expectOne('/api/auth/login').flush(SESSION);
    await login;

    const result = await TestBed.runInInjectionContext(() => authGuard(ROUTE, STATE));

    expect(result).toBe(true);
    http.expectNone('/api/auth/me');
  });

  it('khôi phục phiên đã lưu rồi cho qua', async () => {
    // AuthService chỉ được tạo khi guard chạy, nên token đã có sẵn lúc đó.
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-old');

    const pending = TestBed.runInInjectionContext(() => authGuard(ROUTE, STATE));
    const request = http.expectOne('/api/auth/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-old');
    request.flush({ account: ACCOUNT });

    await expect(pending).resolves.toBe(true);
  });

  it('chuyển về /login kèm redirectTo khi chưa đăng nhập', async () => {
    const result = await TestBed.runInInjectionContext(() => authGuard(ROUTE, STATE));

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/login?redirectTo=%2Fcharacters');
    http.expectNone('/api/auth/me');
  });
});

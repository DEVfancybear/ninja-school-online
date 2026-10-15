import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AccountSchema, AuthSessionSchema } from '@ninja/shared';
import { ApiRequestError } from './api-error';
import { ApiService } from './api.service';
import { fieldSchema } from './schema';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'ninja_test',
  createdAt: '2026-10-15T10:00:00.000Z',
};

const ME_SCHEMA = fieldSchema('account', AccountSchema);

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('trả về phần thân đã đúng hợp đồng', async () => {
    const promise = api.get('/api/auth/me', ME_SCHEMA);
    http.expectOne('/api/auth/me').flush({ account: ACCOUNT });

    await expect(promise).resolves.toEqual(ACCOUNT);
  });

  it('gửi kèm Bearer token khi có token', async () => {
    const promise = api.get('/api/auth/me', ME_SCHEMA, 'token-abc');
    const request = http.expectOne('/api/auth/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-abc');
    request.flush({ account: ACCOUNT });

    await expect(promise).resolves.toEqual(ACCOUNT);
  });

  it('không gửi Authorization khi chưa đăng nhập', async () => {
    const promise = api.get('/api/auth/me', ME_SCHEMA);
    const request = http.expectOne('/api/auth/me');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ account: ACCOUNT });

    await promise;
  });

  it('gửi phần thân JSON khi POST', async () => {
    const promise = api.post('/api/auth/register', { username: 'ninja_test' }, AuthSessionSchema);
    const request = http.expectOne({ method: 'POST', url: '/api/auth/register' });
    expect(request.request.body).toEqual({ username: 'ninja_test' });
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    request.flush(
      { error: 'validation_error', message: 'thiếu mật khẩu' },
      { status: 400, statusText: 'Bad Request' },
    );

    await assertion;
  });

  it('đọc {error, message} của server thành ApiRequestError có mã', async () => {
    const promise = api.post('/api/auth/register', { username: 'ninja_test' }, AuthSessionSchema);
    const request = http.expectOne({ method: 'POST', url: '/api/auth/register' });
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
      message: 'tên đăng nhập đã tồn tại',
    });
    request.flush(
      { error: 'conflict', message: 'tên đăng nhập đã tồn tại' },
      { status: 409, statusText: 'Conflict' },
    );

    await assertion;
  });

  it('dùng thông điệp tiếng Việt mặc định khi server không trả đúng hình dạng lỗi', async () => {
    const promise = api.get('/api/auth/me', ME_SCHEMA);
    const request = http.expectOne('/api/auth/me');

    let caught: unknown;
    const handled = promise.catch((error: unknown) => {
      caught = error;
    });
    request.flush('<html>lỗi máy chủ</html>', { status: 500, statusText: 'Internal Server Error' });
    await handled;

    expect(caught).toBeInstanceOf(ApiRequestError);
    expect(caught).toMatchObject({ code: 'internal_error', status: 500 });
    expect((caught as ApiRequestError).message).toContain('Máy chủ');
  });

  it('báo lỗi mạng khi không gọi được máy chủ', async () => {
    const promise = api.get('/api/auth/me', ME_SCHEMA);
    const request = http.expectOne('/api/auth/me');
    const assertion = expect(promise).rejects.toMatchObject({ code: 'network_error', status: 0 });
    request.error(new ProgressEvent('error'));

    await assertion;
  });

  it('từ chối phản hồi sai hợp đồng', async () => {
    const promise = api.get('/api/auth/me', ME_SCHEMA);
    const request = http.expectOne('/api/auth/me');
    const assertion = expect(promise).rejects.toMatchObject({ code: 'invalid_response' });
    request.flush({ user: ACCOUNT });

    await assertion;
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiRequestError } from '../api/api-error';
import { ACCESS_TOKEN_KEY } from '../auth/auth.service';
import { CharacterService } from './character.service';

const CHARACTER = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Naruto9x',
  school: 'haruna',
  class: 'dao',
  level: 1,
  exp: 0,
  yen: 1000,
  createdAt: '2026-10-15T10:00:00.000Z',
};

describe('CharacterService', () => {
  // `createService()` gán controller của bài kiểm hiện tại vào biến này.
  let http: HttpTestingController;

  function createService(): CharacterService {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(CharacterService);
  }

  beforeEach(() => {
    localStorage.clear();
    // Giả lập đã đăng nhập để service gửi kèm access token.
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-1');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('list: gọi GET /api/characters kèm token và trả về danh sách', async () => {
    const characters = createService();

    const promise = characters.list();
    const request = http.expectOne({ method: 'GET', url: '/api/characters' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-1');
    request.flush({ characters: [CHARACTER] });

    await expect(promise).resolves.toEqual([CHARACTER]);
  });

  it('list: tài khoản chưa có nhân vật trả về mảng rỗng', async () => {
    const characters = createService();

    const promise = characters.list();
    http.expectOne('/api/characters').flush({ characters: [] });

    await expect(promise).resolves.toEqual([]);
  });

  it('list: access token hết hạn thì ném lỗi unauthorized', async () => {
    const characters = createService();

    const promise = characters.list();
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    http
      .expectOne('/api/characters')
      .flush(
        { error: 'unauthorized', message: 'access token hết hạn' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await assertion;
    await expect(promise).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('create: gửi đúng trường của hợp đồng và trả về nhân vật mới', async () => {
    const characters = createService();

    const promise = characters.create({ name: 'Naruto9x', school: 'haruna', class: 'dao' });
    const request = http.expectOne({ method: 'POST', url: '/api/characters' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(request.request.body).toEqual({ name: 'Naruto9x', school: 'haruna', class: 'dao' });
    request.flush({ character: CHARACTER }, { status: 201, statusText: 'Created' });

    await expect(promise).resolves.toEqual(CHARACTER);
  });

  it('create: tên đã tồn tại thì ném lỗi conflict kèm thông điệp của server', async () => {
    const characters = createService();

    const promise = characters.create({ name: 'Naruto9x', school: 'haruna', class: 'dao' });
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'conflict',
      message: 'tên nhân vật đã tồn tại',
    });
    http
      .expectOne({ method: 'POST', url: '/api/characters' })
      .flush(
        { error: 'conflict', message: 'tên nhân vật đã tồn tại' },
        { status: 409, statusText: 'Conflict' },
      );

    await assertion;
  });

  it('create: trả lỗi khi phản hồi không đúng hợp đồng', async () => {
    const characters = createService();

    const promise = characters.create({ name: 'Naruto9x', school: 'haruna', class: 'dao' });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'invalid_response' });
    http
      .expectOne('/api/characters')
      .flush({ character: { name: 'Naruto9x' } }, { status: 201, statusText: 'Created' });

    await assertion;
  });
});

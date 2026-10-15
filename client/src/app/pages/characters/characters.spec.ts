import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MAX_CHARACTERS_PER_ACCOUNT } from '@ninja/shared';
import { vi } from 'vitest';
import { ACCESS_TOKEN_KEY, AuthService } from '../../core/auth/auth.service';
import { Characters } from './characters';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'ninja_test',
  createdAt: '2026-10-15T10:00:00.000Z',
};

const SESSION = { accessToken: 'access-1', refreshToken: 'refresh-1', account: ACCOUNT };

function character(index: number, name = 'Naruto9x') {
  return {
    id: `2222222${index}-2222-4222-8222-222222222222`,
    name,
    school: 'haruna',
    class: 'dao',
    level: 1,
    exp: 0,
    yen: 1000,
    createdAt: '2026-10-15T10:00:00.000Z',
  };
}

/** Chờ hết các microtask mà component sắp chạy sau khi flush một yêu cầu. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Cập nhật giao diện sau khi trạng thái đổi từ code (chuỗi `await` sau phản hồi HTTP):
 * một lượt macrotask cho hết chuỗi promise, một lượt vẽ lại, thêm một lượt nữa cho
 * các lần ghi DOM (ngModel, scheduler của Angular 22 zoneless).
 */
async function render(fixture: ComponentFixture<Characters>): Promise<void> {
  await tick();
  fixture.detectChanges();
  await tick();
  fixture.detectChanges();
}

function element(fixture: ComponentFixture<Characters>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function text(fixture: ComponentFixture<Characters>): string {
  return element(fixture).textContent ?? '';
}

function optionTexts(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((option) => option.textContent?.trim() ?? '');
}

function characterClassSelect(fixture: ComponentFixture<Characters>): HTMLSelectElement {
  const select = element(fixture).querySelector<HTMLSelectElement>('#character-class');
  if (!select) {
    throw new Error('không tìm thấy ô chọn #character-class');
  }
  return select;
}

function selectValue(fixture: ComponentFixture<Characters>, id: string, value: string): void {
  const select = element(fixture).querySelector<HTMLSelectElement>(`#${id}`);
  if (!select) {
    throw new Error(`không tìm thấy ô chọn #${id}`);
  }
  select.value = value;
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function setInput(fixture: ComponentFixture<Characters>, id: string, value: string): void {
  const input = element(fixture).querySelector<HTMLInputElement>(`#${id}`);
  if (!input) {
    throw new Error(`không tìm thấy ô nhập #${id}`);
  }
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function submitForm(fixture: ComponentFixture<Characters>): void {
  element(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function findButton(fixture: ComponentFixture<Characters>, label: string): HTMLButtonElement {
  const button = Array.from(element(fixture).querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) {
    throw new Error(`không tìm thấy nút "${label}"`);
  }
  return button;
}

describe('Characters', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Characters],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);

    // Route này nằm sau authGuard, nên trang luôn có tài khoản đang đăng nhập.
    const login = auth.login({ username: 'ninja_test', password: 'matkhau123' });
    http.expectOne('/api/auth/login').flush(SESSION);
    await login;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  async function openPage(): Promise<ComponentFixture<Characters>> {
    const fixture = TestBed.createComponent(Characters);
    fixture.detectChanges();
    await tick();
    return fixture;
  }

  async function loadPage(characters = [character(1)]): Promise<ComponentFixture<Characters>> {
    const fixture = await openPage();
    http.expectOne({ method: 'GET', url: '/api/characters' }).flush({ characters });
    await render(fixture);
    return fixture;
  }

  it('trạng thái rỗng: hướng dẫn tạo nhân vật đầu tiên', async () => {
    const fixture = await loadPage([]);

    expect(text(fixture)).toContain('Bạn chưa có nhân vật nào');
    expect(text(fixture)).toContain('nhân vật đầu tiên');
    expect(element(fixture).querySelector('#character-name')).not.toBeNull();
  });

  it('hiển thị tên, trường, phái, cấp và Yên của từng nhân vật', async () => {
    const fixture = await loadPage([character(1)]);

    expect(text(fixture)).toContain('Naruto9x');
    expect(text(fixture)).toContain('Haruna');
    expect(text(fixture)).toContain('Đao');
    expect(text(fixture)).toContain('1.000');
    expect(text(fixture)).toContain('Tài khoản: ninja_test');
  });

  it('chọn trường thì chỉ hiện hai phái của trường đó', async () => {
    const fixture = await loadPage([]);
    expect(optionTexts(characterClassSelect(fixture))).toEqual(['Đao', 'Quạt']);

    selectValue(fixture, 'character-school', 'hirosaki');
    await render(fixture);
    expect(optionTexts(characterClassSelect(fixture))).toEqual(['Kiếm', 'Phiêu Tiêu']);
    expect(characterClassSelect(fixture).value).toBe('kiem');

    selectValue(fixture, 'character-school', 'ookaza');
    await render(fixture);
    expect(optionTexts(characterClassSelect(fixture))).toEqual(['Kunai', 'Cung']);
    expect(characterClassSelect(fixture).value).toBe('kunai');
  });

  it('tên nhân vật sai: hiện lỗi của schema và không gọi API', async () => {
    const fixture = await loadPage([]);
    setInput(fixture, 'character-name', 'Naruto 9x');

    submitForm(fixture);
    await render(fixture);

    expect(text(fixture)).toContain('tên nhân vật chỉ gồm chữ cái và chữ số, không có dấu cách');
    http.expectNone({ method: 'POST', url: '/api/characters' });
  });

  it('tạo nhân vật: khoá biểu mẫu khi đang gửi rồi thêm nhân vật mới vào danh sách', async () => {
    const fixture = await loadPage([]);
    setInput(fixture, 'character-name', 'Naruto9x');

    submitForm(fixture);
    await tick();

    const request = http.expectOne({ method: 'POST', url: '/api/characters' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(request.request.body).toEqual({ name: 'Naruto9x', school: 'haruna', class: 'dao' });
    await render(fixture);
    expect(findButton(fixture, 'Đang xử lý').disabled).toBe(true);

    request.flush({ character: character(1) }, { status: 201, statusText: 'Created' });
    await render(fixture);

    expect(text(fixture)).toContain('Naruto9x');
    expect(element(fixture).querySelector<HTMLInputElement>('#character-name')?.value).toBe('');
    expect(text(fixture)).toContain('Đã dùng 1/4 nhân vật');
  });

  it('tên nhân vật trùng: hiện thông báo của server', async () => {
    const fixture = await loadPage([]);
    setInput(fixture, 'character-name', 'Naruto9x');
    submitForm(fixture);
    await tick();

    http
      .expectOne({ method: 'POST', url: '/api/characters' })
      .flush(
        { error: 'conflict', message: 'tên nhân vật đã tồn tại' },
        { status: 409, statusText: 'Conflict' },
      );
    await render(fixture);

    expect(element(fixture).querySelector('.alert')?.textContent).toContain(
      'tên nhân vật đã tồn tại',
    );
  });

  it('đủ nhân vật: ẩn biểu mẫu tạo và ghi chú lý do', async () => {
    const full = Array.from({ length: MAX_CHARACTERS_PER_ACCOUNT }, (_, index) =>
      character(index + 1, `Ninja${index + 1}x`),
    );
    const fixture = await loadPage(full);

    expect(element(fixture).querySelector('#character-name')).toBeNull();
    expect(text(fixture)).toContain('đã đủ 4 nhân vật');
    expect(text(fixture)).toContain('Ninja4x');
  });

  it('lỗi tải danh sách: hiện thông báo và cho thử lại', async () => {
    const fixture = await openPage();
    http
      .expectOne({ method: 'GET', url: '/api/characters' })
      .flush(
        { error: 'internal_error', message: 'máy chủ đang bảo trì' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await render(fixture);

    expect(element(fixture).querySelector('.alert')?.textContent).toContain('máy chủ đang bảo trì');

    findButton(fixture, 'Thử lại').click();
    fixture.detectChanges();
    await tick();
    http.expectOne({ method: 'GET', url: '/api/characters' }).flush({ characters: [] });
    await render(fixture);

    expect(text(fixture)).toContain('Bạn chưa có nhân vật nào');
  });

  it('đăng xuất: xoá phiên và về trang đăng nhập', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await loadPage([]);

    findButton(fixture, 'Đăng xuất').click();
    await tick();

    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});

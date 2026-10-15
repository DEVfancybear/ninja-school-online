import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ACCESS_TOKEN_KEY } from '../../core/auth/auth.service';
import { Login } from './login';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'ninja_test',
  createdAt: '2026-10-15T10:00:00.000Z',
};

const SESSION = { accessToken: 'access-1', refreshToken: 'refresh-1', account: ACCOUNT };

/** Chờ hết các microtask mà component sắp chạy sau khi flush một yêu cầu. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Cập nhật giao diện sau khi trạng thái đổi từ code (chuỗi `await` sau phản hồi HTTP):
 * một lượt macrotask cho hết chuỗi promise, một lượt vẽ lại, thêm một lượt nữa cho
 * các lần ghi DOM (ngModel, scheduler của Angular 22 zoneless).
 */
async function render(fixture: ComponentFixture<Login>): Promise<void> {
  await tick();
  fixture.detectChanges();
  await tick();
  fixture.detectChanges();
}

function element(fixture: ComponentFixture<Login>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function text(fixture: ComponentFixture<Login>): string {
  return element(fixture).textContent ?? '';
}

function setInput(fixture: ComponentFixture<Login>, id: string, value: string): void {
  const input = element(fixture).querySelector<HTMLInputElement>(`#${id}`);
  if (!input) {
    throw new Error(`không tìm thấy ô nhập #${id}`);
  }
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function openRegisterTab(fixture: ComponentFixture<Login>): void {
  const tabs = element(fixture).querySelectorAll<HTMLButtonElement>('button.tab');
  tabs[1].click();
  fixture.detectChanges();
}

function submitForm(fixture: ComponentFixture<Login>): void {
  element(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function submitButton(fixture: ComponentFixture<Login>): HTMLButtonElement {
  const button = element(fixture).querySelector<HTMLButtonElement>('button.submit');
  if (!button) {
    throw new Error('không tìm thấy nút gửi biểu mẫu');
  }
  return button;
}

describe('Login', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  async function createPage(): Promise<ComponentFixture<Login>> {
    const fixture = TestBed.createComponent(Login);
    await render(fixture);
    return fixture;
  }

  it('tên đăng nhập sai quy tắc: hiện lỗi tiếng Việt của schema và không gọi API', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await createPage();
    setInput(fixture, 'username', 'Abcd');
    setInput(fixture, 'password', 'matkhau123');

    submitForm(fixture);
    await render(fixture);

    expect(text(fixture)).toContain('tên đăng nhập chỉ gồm chữ thường, chữ số và dấu gạch dưới');
    http.expectNone('/api/auth/login');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('mật khẩu để trống: hiện lỗi ngay dưới ô mật khẩu và không gọi API', async () => {
    const fixture = await createPage();
    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', '');

    submitForm(fixture);
    await render(fixture);

    expect(text(fixture)).toContain('hãy nhập mật khẩu');
    http.expectNone('/api/auth/login');
  });

  it('tab đăng ký: kiểm tra mật khẩu tối thiểu 8 ký tự trước khi gọi API', async () => {
    const fixture = await createPage();
    openRegisterTab(fixture);
    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', '123');

    submitForm(fixture);
    await render(fixture);

    expect(text(fixture)).toContain('mật khẩu phải có ít nhất 8 ký tự');
    http.expectNone('/api/auth/register');
  });

  it('email sai định dạng: hiện lỗi tiếng Việt và không gọi API', async () => {
    const fixture = await createPage();
    openRegisterTab(fixture);
    await render(fixture);
    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', 'matkhau123');
    setInput(fixture, 'email', 'khong-phai-email');

    submitForm(fixture);
    await render(fixture);

    expect(text(fixture)).toContain('địa chỉ email không hợp lệ');
    http.expectNone('/api/auth/register');
  });

  it('đăng nhập thành công: khoá nút khi đang gửi, lưu phiên và sang /characters', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await createPage();
    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', 'matkhau123');

    submitForm(fixture);
    await tick();

    const request = http.expectOne({ method: 'POST', url: '/api/auth/login' });
    expect(request.request.body).toEqual({ username: 'ninja_test', password: 'matkhau123' });
    await render(fixture);
    expect(submitButton(fixture).disabled).toBe(true);
    expect(submitButton(fixture).textContent).toContain('Đang xử lý');

    request.flush(SESSION);
    await render(fixture);

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-1');
    expect(navigate).toHaveBeenCalledWith('/characters');
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('tab đăng ký: hiện thêm ô email và gửi đúng endpoint', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await createPage();
    openRegisterTab(fixture);
    await render(fixture);
    expect(element(fixture).querySelector('#email')).not.toBeNull();

    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', 'matkhau123');
    setInput(fixture, 'email', ' ninja@example.com ');
    submitForm(fixture);
    await tick();

    const request = http.expectOne({ method: 'POST', url: '/api/auth/register' });
    expect(request.request.body).toEqual({
      username: 'ninja_test',
      password: 'matkhau123',
      email: 'ninja@example.com',
    });
    request.flush(SESSION, { status: 201, statusText: 'Created' });
    await render(fixture);

    expect(navigate).toHaveBeenCalledWith('/characters');
  });

  it('hiện thông báo của server khi tên đăng nhập đã tồn tại', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await createPage();
    openRegisterTab(fixture);
    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', 'matkhau123');
    submitForm(fixture);
    await tick();

    http
      .expectOne({ method: 'POST', url: '/api/auth/register' })
      .flush(
        { error: 'conflict', message: 'tên đăng nhập đã tồn tại' },
        { status: 409, statusText: 'Conflict' },
      );
    await render(fixture);

    const alert = element(fixture).querySelector('.alert');
    expect(alert?.textContent).toContain('tên đăng nhập đã tồn tại');
    expect(submitButton(fixture).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('quay lại đúng redirectTo do route guard gửi kèm', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await createPage();
    fixture.componentRef.setInput('redirectTo', '/play');
    setInput(fixture, 'username', 'ninja_test');
    setInput(fixture, 'password', 'matkhau123');

    submitForm(fixture);
    await tick();

    http.expectOne('/api/auth/login').flush(SESSION);
    await render(fixture);

    expect(navigate).toHaveBeenCalledWith('/play');
  });
});

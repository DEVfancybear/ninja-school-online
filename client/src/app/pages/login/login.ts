import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LoginRequestSchema, RegisterRequestSchema } from '@ninja/shared';
import { apiErrorMessage } from '../../core/api/api-error';
import { type FieldErrors, validateSchema } from '../../core/api/validation';
import { AuthService } from '../../core/auth/auth.service';

type Mode = 'login' | 'register';

/**
 * Vài quy tắc của schema dùng chung còn câu mặc định tiếng Anh của zod (`EmailSchema`);
 * giao diện tiếng Việt nên đổi lại cho đúng ô nhập đang báo lỗi.
 */
const FIELD_MESSAGES: FieldErrors = { email: 'địa chỉ email không hợp lệ' };

/** Một trang cho cả đăng nhập và đăng ký; đổi qua lại bằng hai tab trên đầu. */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /**
   * Route được bảo vệ gửi kèm `?redirectTo=...` để sau khi vào quay lại đúng chỗ.
   * Phải khai báo là `string | undefined`: khi mở thẳng `/login` (không có tham số),
   * Angular gán giá trị `undefined` cho input nên không thể dựa vào giá trị mặc định.
   */
  readonly redirectTo = input<string | undefined>(undefined);

  readonly mode = signal<Mode>('login');
  readonly isRegister = computed(() => this.mode() === 'register');
  readonly busy = signal(false);
  readonly fieldErrors = signal<FieldErrors>({});
  readonly formError = signal<string | null>(null);
  readonly submitLabel = computed(() => (this.isRegister() ? 'Tạo tài khoản' : 'Đăng nhập'));

  readonly username = signal('');
  readonly password = signal('');
  readonly email = signal('');

  fieldError(field: string): string | undefined {
    const message = this.fieldErrors()[field];
    if (message === undefined) {
      return undefined;
    }
    return FIELD_MESSAGES[field] ?? message;
  }

  setMode(mode: Mode): void {
    if (mode === this.mode()) {
      return;
    }
    this.mode.set(mode);
    this.fieldErrors.set({});
    this.formError.set(null);
  }

  async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (this.isRegister()) {
      await this.submitRegister();
    } else {
      await this.submitLogin();
    }
  }

  private async submitRegister(): Promise<void> {
    const outcome = validateSchema(RegisterRequestSchema, {
      username: this.username(),
      password: this.password(),
      email: this.normalizedEmail(),
    });
    if (!outcome.ok) {
      this.rejectInput(outcome.fieldErrors);
      return;
    }
    await this.send(() => this.auth.register(outcome.data));
  }

  private async submitLogin(): Promise<void> {
    const outcome = validateSchema(LoginRequestSchema, {
      username: this.username(),
      password: this.password(),
    });
    if (!outcome.ok) {
      this.rejectInput(outcome.fieldErrors);
      return;
    }
    await this.send(() => this.auth.login(outcome.data));
  }

  private async send(action: () => Promise<unknown>): Promise<void> {
    this.fieldErrors.set({});
    this.formError.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.formError.set(apiErrorMessage(error));
      return;
    } finally {
      this.busy.set(false);
    }

    // Điều hướng nằm ngoài `try` trên: lỗi ở bước này không phải lỗi đăng nhập/đăng ký,
    // và trước đây bị nuốt thành thông báo chung nên rất khó tìm nguyên nhân.
    await this.router.navigateByUrl(this.targetUrl());
  }

  private rejectInput(fieldErrors: FieldErrors): void {
    this.fieldErrors.set(fieldErrors);
    this.formError.set('Vui lòng kiểm tra lại các ô được báo lỗi.');
  }

  private normalizedEmail(): string | undefined {
    const email = this.email().trim();
    return email.length > 0 ? email : undefined;
  }

  private targetUrl(): string {
    const target = this.redirectTo();
    // Chỉ nhận đường dẫn nội bộ, tránh chuyển hướng ra ngoài (open redirect).
    return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
      ? target
      : '/characters';
  }
}

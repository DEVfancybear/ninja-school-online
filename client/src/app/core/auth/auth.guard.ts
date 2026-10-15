import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Chặn route khi chưa đăng nhập: thử khôi phục phiên đã lưu trước, không được thì
 * chuyển về `/login` kèm `redirectTo` để quay lại đúng chỗ sau khi vào.
 *
 * Cả hai `inject()` đều gọi ngay trong lượt đồng bộ (không đặt sau `await`) để ngữ cảnh
 * tiêm còn hiệu lực; phần chờ mạng trả về `Promise` cho router tự chờ.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return auth
    .restoreSession()
    .then((account) =>
      account ? true : router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } }),
    );
};

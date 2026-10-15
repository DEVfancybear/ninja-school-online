import { ApiErrorCode, type ApiErrorCode as ApiErrorCodeValue } from '@ninja/shared';

/** Lỗi nghiệp vụ có mã và mã HTTP xác định; tầng route chuyển thẳng thành phản hồi lỗi. */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCodeValue,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function validationError(message: string): AppError {
  return new AppError(ApiErrorCode.VALIDATION, message, 400);
}

export function unauthorizedError(message = 'bạn cần đăng nhập để làm việc này'): AppError {
  return new AppError(ApiErrorCode.UNAUTHORIZED, message, 401);
}

export function conflictError(message: string): AppError {
  return new AppError(ApiErrorCode.CONFLICT, message, 409);
}

export function notFoundError(message: string): AppError {
  return new AppError(ApiErrorCode.NOT_FOUND, message, 404);
}

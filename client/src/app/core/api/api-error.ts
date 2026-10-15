import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorCode, ApiErrorSchema } from '@ninja/shared';

/**
 * Mã lỗi phía client có thể gặp: các mã trong hợp đồng của server, cộng vài mã chỉ client tạo ra
 * (mất mạng, phản hồi sai hợp đồng, lỗi không xác định).
 */
export type ApiFailureCode =
  ApiErrorCode | 'network_error' | 'timeout' | 'invalid_response' | 'unexpected_error';

const STATUS_CODES: readonly (readonly [number, ApiErrorCode])[] = [
  [400, ApiErrorCode.VALIDATION],
  [401, ApiErrorCode.UNAUTHORIZED],
  [403, ApiErrorCode.UNAUTHORIZED],
  [404, ApiErrorCode.NOT_FOUND],
  [409, ApiErrorCode.CONFLICT],
];

/** Dùng khi server không trả về thông điệp: vẫn phải nói được điều gì đó dễ hiểu cho người chơi. */
const FALLBACK_MESSAGES: Record<ApiErrorCode, string> = {
  [ApiErrorCode.VALIDATION]: 'Dữ liệu gửi lên không hợp lệ.',
  [ApiErrorCode.UNAUTHORIZED]: 'Bạn cần đăng nhập để tiếp tục.',
  [ApiErrorCode.CONFLICT]: 'Dữ liệu này đã tồn tại.',
  [ApiErrorCode.NOT_FOUND]: 'Không tìm thấy dữ liệu yêu cầu.',
  [ApiErrorCode.INTERNAL]: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
};

const NETWORK_MESSAGE = 'Không kết nối được tới máy chủ. Kiểm tra kết nối mạng rồi thử lại.';
const TIMEOUT_MESSAGE = 'Máy chủ không phản hồi kịp. Kiểm tra kết nối mạng rồi thử lại.';
const UNEXPECTED_MESSAGE = 'Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.';

/** Lỗi đã chuẩn hoá (mã + thông điệp + mã HTTP) để tầng giao diện hiển thị thẳng cho người chơi. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: ApiFailureCode,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return (Object.values(ApiErrorCode) as readonly string[]).includes(value);
}

/** Mã HTTP → mã lỗi của hợp đồng, dùng khi server không trả về đúng hình dạng lỗi. */
export function errorCodeForStatus(status: number): ApiErrorCode {
  return STATUS_CODES.find(([code]) => code === status)?.[1] ?? ApiErrorCode.INTERNAL;
}

/**
 * Chuẩn hoá mọi lỗi của `HttpClient` thành `ApiRequestError`:
 * đọc `{error, message}` của server, còn lại thì dùng thông điệp tiếng Việt mặc định.
 */
export function toApiRequestError(error: unknown): ApiRequestError {
  if (isApiRequestError(error)) {
    return error;
  }
  if (!(error instanceof HttpErrorResponse)) {
    return new ApiRequestError(UNEXPECTED_MESSAGE, 'unexpected_error');
  }
  if (error.status === 0) {
    return new ApiRequestError(NETWORK_MESSAGE, 'network_error');
  }

  const fallbackCode = errorCodeForStatus(error.status);
  const parsed = ApiErrorSchema.safeParse(error.error);
  if (!parsed.success) {
    return new ApiRequestError(FALLBACK_MESSAGES[fallbackCode], fallbackCode, error.status);
  }

  const message =
    parsed.data.message.trim().length > 0 ? parsed.data.message : FALLBACK_MESSAGES[fallbackCode];
  const code = isApiErrorCode(parsed.data.error) ? parsed.data.error : fallbackCode;
  return new ApiRequestError(message, code, error.status);
}

/**
 * Lỗi khi máy chủ không trả lời trong thời gian cho phép. Tách riêng khỏi lỗi mạng
 * để người chơi biết là đã gửi được yêu cầu nhưng chờ quá lâu.
 */
export function toTimeoutError(): ApiRequestError {
  return new ApiRequestError(TIMEOUT_MESSAGE, 'timeout');
}

/** Thông điệp hiển thị cho người chơi; không lộ chi tiết kỹ thuật của lỗi lạ. */
export function apiErrorMessage(error: unknown): string {
  return isApiRequestError(error) ? error.message : UNEXPECTED_MESSAGE;
}

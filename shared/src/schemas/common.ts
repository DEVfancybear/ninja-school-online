import { z } from 'zod';

/** Hình dạng lỗi mà server trả về cho mọi phản hồi thất bại. */
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiErrorCode = {
  VALIDATION: 'validation_error',
  UNAUTHORIZED: 'unauthorized',
  CONFLICT: 'conflict',
  NOT_FOUND: 'not_found',
  INTERNAL: 'internal_error',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

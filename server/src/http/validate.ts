import type { ZodType } from 'zod';
import { validationError } from '../errors.js';

/** Kiểm tra dữ liệu vào bằng schema của `@ninja/shared`; sai thì ném lỗi 400 kèm mô tả tiếng Việt. */
export function parseRequest<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') ?? '';
    throw validationError(
      issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'dữ liệu gửi lên không hợp lệ',
    );
  }
  return result.data;
}

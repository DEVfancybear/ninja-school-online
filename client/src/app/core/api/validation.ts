import { type ApiSchema, type SchemaIssue } from './schema';

/** Lỗi theo từng trường của biểu mẫu: `tên_trường -> thông điệp tiếng Việt`. */
export type FieldErrors = Record<string, string>;

/** Khoá dành cho lỗi không gắn với ô nhập cụ thể nào. */
export const FORM_ERROR_KEY = '_form';

export type ValidationOutcome<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly fieldErrors: FieldErrors };

/**
 * Gom lỗi của schema về từng trường, giữ lỗi đầu tiên của mỗi trường
 * để hiển thị ngay dưới ô nhập tương ứng.
 */
export function toFieldErrors(issues: readonly SchemaIssue[]): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : FORM_ERROR_KEY;
    if (fieldErrors[field] === undefined) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}

/**
 * Chạy schema của `@ninja/shared` trên dữ liệu biểu mẫu trước khi gửi lên server.
 * Client kiểm tra sớm cho người chơi biết ngay; server vẫn là nơi kiểm tra thật.
 */
export function validateSchema<T>(schema: ApiSchema<T>, value: unknown): ValidationOutcome<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, fieldErrors: toFieldErrors(result.error.issues) };
}

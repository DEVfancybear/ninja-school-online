/**
 * Mặt tối thiểu của một schema zod mà client cần (chỉ `safeParse`).
 *
 * Nhờ vậy client không phải phụ thuộc trực tiếp vào `zod`: mọi schema thật vẫn lấy từ
 * `@ninja/shared` — nguồn sự thật của hợp đồng client ↔ server.
 */
export interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export type SchemaResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly SchemaIssue[] } };

export interface ApiSchema<T> {
  safeParse(value: unknown): SchemaResult<T>;
}

/**
 * Kiểm tra một trường của phản hồi bọc ngoài bằng schema của chính trường đó,
 * ví dụ `GET /api/auth/me` trả `{account: {...}}` → `fieldSchema('account', AccountSchema)`.
 */
export function fieldSchema<T>(field: string, schema: ApiSchema<T>): ApiSchema<T> {
  return {
    safeParse(value: unknown): SchemaResult<T> {
      const record = value as Record<string, unknown> | null;
      if (record === null || typeof record !== 'object' || !(field in record)) {
        return {
          success: false,
          error: { issues: [{ path: [field], message: `phản hồi thiếu trường "${field}"` }] },
        };
      }
      return schema.safeParse(record[field]);
    },
  };
}

/** Thông điệp của lỗi đầu tiên, dùng cho các thông báo ngắn. */
export function firstIssueMessage(issues: readonly SchemaIssue[]): string {
  return issues[0]?.message ?? 'dữ liệu không hợp lệ';
}

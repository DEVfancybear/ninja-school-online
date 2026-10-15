import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TimeoutError, firstValueFrom, timeout } from 'rxjs';
import { ApiRequestError, toApiRequestError, toTimeoutError } from './api-error';
import { type ApiSchema, firstIssueMessage } from './schema';

type ApiMethod = 'GET' | 'POST';

/**
 * Thời hạn tối đa cho một yêu cầu API. Cần có vì mạng treo (không phải mất mạng hẳn) có thể
 * giữ người chơi ở màn hình chờ vô hạn — ví dụ bấm "Đăng xuất" mà không bao giờ được điều hướng.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Lớp mỏng bọc `HttpClient`: gọi endpoint dưới `/api` bằng đường dẫn tương đối
 * (dev server chuyển tiếp sang server game qua `proxy.conf.json`), kiểm tra phản hồi bằng
 * schema của `@ninja/shared` rồi luôn ném `ApiRequestError` để tầng giao diện hiển thị.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, schema: ApiSchema<T>, token?: string | null): Promise<T> {
    return this.send('GET', path, schema, undefined, token);
  }

  post<T>(path: string, body: unknown, schema: ApiSchema<T>, token?: string | null): Promise<T> {
    return this.send('POST', path, schema, body, token);
  }

  private async send<T>(
    method: ApiMethod,
    path: string,
    schema: ApiSchema<T>,
    body: unknown,
    token?: string | null,
  ): Promise<T> {
    const options: { headers: HttpHeaders; body?: unknown } = { headers: this.authHeaders(token) };
    if (body !== undefined) {
      options.body = body;
    }

    try {
      const response = await firstValueFrom(
        this.http.request<unknown>(method, path, options).pipe(timeout(REQUEST_TIMEOUT_MS)),
      );
      return this.parse(schema, response);
    } catch (error) {
      // `TimeoutError` của rxjs không phải HttpErrorResponse nên phải xử lý riêng,
      // nếu không người chơi sẽ nhận thông báo chung "lỗi không mong đợi" khó hiểu.
      throw error instanceof TimeoutError ? toTimeoutError() : toApiRequestError(error);
    }
  }

  private parse<T>(schema: ApiSchema<T>, response: unknown): T {
    const result = schema.safeParse(response);
    if (result.success) {
      return result.data;
    }
    throw new ApiRequestError(
      `Phản hồi của máy chủ không đúng hợp đồng: ${firstIssueMessage(result.error.issues)}`,
      'invalid_response',
    );
  }

  private authHeaders(token?: string | null): HttpHeaders {
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }
}

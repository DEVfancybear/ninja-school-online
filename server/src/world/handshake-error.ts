import type { ErrorCode } from '@ninja/shared';

/**
 * Lỗi trong lúc bắt tay (`C2S_HELLO`). Mọi lỗi bắt tay đều là **fatal**: tầng `net/` gửi
 * `S2C_ERROR` với đúng mã này rồi đóng kết nối.
 */
export class HandshakeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HandshakeError';
  }
}

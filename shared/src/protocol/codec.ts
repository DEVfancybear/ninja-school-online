import { z } from 'zod';
import { CLIENT_PACKETS, SERVER_PACKETS, type PacketSchemaTable } from './packets.js';
import { OPCODE_NAMES } from './opcodes.js';

/** Khung gói tin trên đường truyền. Ở M2 dùng JSON text frame cho dễ gỡ lỗi. */
export const EnvelopeSchema = z.object({
  op: z.number().int().min(0).max(0xffff),
  seq: z.number().int().min(0).default(0),
  payload: z.unknown().default({}),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly op: number; readonly reason: string };

function describe(issues: readonly z.core.$ZodIssue[]): string {
  const first = issues[0];
  if (!first) {
    return 'dữ liệu không hợp lệ';
  }
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * Đọc phần thân của gói tin theo bảng schema tương ứng với `op`.
 * Trả về lỗi có mô tả thay vì ném, vì dữ liệu đến từ mạng.
 */
export function decodePayload<T = unknown>(
  table: PacketSchemaTable,
  op: number,
  payload: unknown,
): DecodeResult<T> {
  const schema = table[op];
  if (!schema) {
    return {
      ok: false,
      op,
      reason: `mã gói tin không hỗ trợ: ${op} (${OPCODE_NAMES[op] ?? 'không rõ'})`,
    };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, op, reason: describe(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data as T };
}

/** Giải mã một gói tin client gửi lên (đã tách khỏi khung). */
export function decodeClientPacket(op: number, payload: unknown): DecodeResult<unknown> {
  return decodePayload(CLIENT_PACKETS, op, payload);
}

/** Giải mã một gói tin server gửi xuống. */
export function decodeServerPacket(op: number, payload: unknown): DecodeResult<unknown> {
  return decodePayload(SERVER_PACKETS, op, payload);
}

/** Mã hoá một gói tin thành chuỗi JSON để gửi qua WebSocket. */
export function encodePacket(op: number, payload: unknown, seq = 0): string {
  return JSON.stringify({ op, seq, payload });
}

/**
 * Đọc khung gói tin từ một chuỗi nhận được trên WebSocket.
 *
 * Nhận `string` (không nhận `Uint8Array`) để thư viện dùng chung không phụ thuộc API của
 * trình duyệt hay của Node: ở M2 hai bên chỉ gửi text frame, phía Node tự đổi Buffer thành
 * chuỗi trước khi gọi hàm này.
 */
export function decodeEnvelope(raw: string): DecodeResult<Envelope> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, op: -1, reason: 'không đọc được JSON' };
  }

  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, op: -1, reason: describe(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

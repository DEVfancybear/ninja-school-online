import type { Db } from './client.js';
import { transactions, type TransactionKind } from './schema.js';

/** Một lần đổi trạng thái của nhân vật mà người đọc sổ cần thấy: ai, món gì, bao nhiêu, lời giải thích. */
export interface TransactionEntry {
  readonly characterId: string;
  readonly kind: TransactionKind;
  readonly itemId: string;
  readonly quantity: number;
  /** Yên tăng (bán) hay giảm (mua, cường hóa). */
  readonly yenDelta: number;
  readonly detail: string;
}

/**
 * Ghi một hàng nhật ký giao dịch. Chỉ gọi sau khi giao dịch **đã thành công**: giao dịch bị từ chối
 * không đổi trạng thái của ai nên không thuộc về sổ.
 */
export async function logTransaction(db: Db, entry: TransactionEntry): Promise<void> {
  await db.insert(transactions).values(entry);
}

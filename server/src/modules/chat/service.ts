import { CHAT_MIN_INTERVAL_MS, type ChatMessage } from '@ninja/shared';

/** Ai đó gửi tin nhắn: chỉ cần id và tên hiển thị. */
export interface ChatParticipant {
  readonly id: string;
  readonly name: string;
}

export interface ChatServiceOptions {
  /** Giãn cách tối thiểu giữa hai tin của cùng một người (mặc định `CHAT_MIN_INTERVAL_MS`). */
  minIntervalMs?: number;
  now?: () => number;
}

/**
 * Luật chat của M2: **một kênh `map`**, giới hạn tần suất theo từng người chơi (không theo map,
 * nên đổi map không xoá được giới hạn).
 */
export class ChatService {
  private readonly lastSentAt = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(options: ChatServiceOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? CHAT_MIN_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** `true` nếu người chơi được phép gửi; đồng thời ghi nhận thời điểm gửi. */
  allow(playerId: string, intervalMs = this.minIntervalMs): boolean {
    const now = this.now();
    const previous = this.lastSentAt.get(playerId);
    if (previous !== undefined && now - previous < intervalMs) {
      return false;
    }
    this.lastSentAt.set(playerId, now);
    return true;
  }

  /** Quên trạng thái của một người chơi khi họ rời game (không giữ map phình dần). */
  forget(playerId: string): void {
    this.lastSentAt.delete(playerId);
  }

  /** Tin nhắn kênh `map` từ một người chơi, `at` là thời điểm server (ms epoch). */
  mapMessage(from: ChatParticipant, text: string, at: number): ChatMessage {
    return { channel: 'map', fromId: from.id, fromName: from.name, text, at };
  }
}

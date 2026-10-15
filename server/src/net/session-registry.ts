import type { GameSession } from './session.js';

/**
 * Phiên đang hoạt động theo nhân vật. Quy tắc trong `docs/02-architecture/network-and-data.md`
 * mục 4: **một nhân vật chỉ có một kết nối**; đăng nhập nơi khác thì phiên cũ bị đẩy ra (chống
 * treo tài khoản).
 */
export class SessionRegistry {
  private readonly byCharacter = new Map<string, GameSession>();

  /** Ghi phiên mới cho nhân vật; trả về phiên cũ đang giữ nhân vật đó (nếu có). */
  register(characterId: string, session: GameSession): GameSession | undefined {
    const previous = this.byCharacter.get(characterId);
    this.byCharacter.set(characterId, session);
    return previous;
  }

  /** Phiên đang điều khiển một nhân vật; `undefined` nếu nhân vật không online. */
  get(characterId: string): GameSession | undefined {
    return this.byCharacter.get(characterId);
  }

  /** Bỏ đăng ký, chỉ khi phiên đang giữ nhân vật đúng là phiên này. */
  release(characterId: string, session: GameSession): void {
    if (this.byCharacter.get(characterId) === session) {
      this.byCharacter.delete(characterId);
    }
  }

  get size(): number {
    return this.byCharacter.size;
  }
}

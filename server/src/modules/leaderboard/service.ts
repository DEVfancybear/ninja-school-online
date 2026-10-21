import { and, desc, eq, sql } from 'drizzle-orm';
import {
  LEADERBOARD_MAX_ENTRIES,
  type Character,
  type LeaderboardEntry,
  type LeaderboardRequest,
  type LeaderboardView,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characterArena, characters } from '../../db/schema.js';

/**
 * Bảng xếp hạng (M6). Hai bảng, hai thứ tự:
 *
 * - `level`: cấp giảm dần, cùng cấp thì kinh nghiệm nhiều hơn đứng trước, cuối cùng theo tên để thứ
 *   tự **ổn định** giữa các lần gọi.
 * - `arena`: điểm giảm dần, cùng điểm thì số trận thắng nhiều hơn đứng trước. Chỉ người **đã đấu ít
 *   nhất một trận** mới có mặt — người chưa từng vào Lôi Đài không chiếm suất của người đã đấu.
 *
 * `rank` luôn bắt đầu từ 1 và đánh số liên tục trong phạm vi trả về.
 */
export class LeaderboardService {
  constructor(private readonly db: Db) {}

  async top(request: LeaderboardRequest): Promise<LeaderboardView> {
    const limit = Math.min(request.limit ?? LEADERBOARD_MAX_ENTRIES, LEADERBOARD_MAX_ENTRIES);
    const entries =
      request.board === 'arena' ? await this.arenaEntries(limit) : await this.levelEntries(limit);
    return {
      board: request.board,
      entries: entries.map((entry, index) => ({ rank: index + 1, ...entry })),
    };
  }

  private async levelEntries(limit: number): Promise<Omit<LeaderboardEntry, 'rank'>[]> {
    const rows = await this.db
      .select({
        name: characters.name,
        level: characters.level,
        school: characters.school,
        class: characters.class,
      })
      .from(characters)
      .orderBy(desc(characters.level), desc(characters.exp), characters.name)
      .limit(limit);
    return rows.map((row) => ({
      name: row.name,
      level: row.level,
      school: row.school as Character['school'],
      class: row.class as Character['class'],
    }));
  }

  private async arenaEntries(limit: number): Promise<Omit<LeaderboardEntry, 'rank'>[]> {
    const rows = await this.db
      .select({
        name: characters.name,
        level: characters.level,
        school: characters.school,
        class: characters.class,
        rating: characterArena.rating,
        wins: characterArena.wins,
        losses: characterArena.losses,
      })
      .from(characterArena)
      .innerJoin(characters, eq(characters.id, characterArena.characterId))
      // "Đã đấu ít nhất một trận": chỉ số trận mới phân biệt được với người chưa từng vào Lôi Đài.
      .where(and(sql`${characterArena.wins} + ${characterArena.losses} > 0`))
      .orderBy(desc(characterArena.rating), desc(characterArena.wins), characters.name)
      .limit(limit);
    return rows.map((row) => ({
      name: row.name,
      level: row.level,
      school: row.school as Character['school'],
      class: row.class as Character['class'],
      rating: row.rating,
      wins: row.wins,
      losses: row.losses,
    }));
  }
}

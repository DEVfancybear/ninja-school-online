import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GUILD_LEVEL_EXP,
  GUILD_MAX_LEVEL,
  GUILD_MAX_MEMBERS,
  GUILD_NAME_MAX_LENGTH,
  GuildNameSchema,
  Opcode,
  type GuildUpdate,
  type SocialPerson,
} from '@ninja/shared';
import type { Db } from '../../db/client.js';
import { characters, guildMembers, guilds } from '../../db/schema.js';
import type { SessionRegistry } from '../../net/session-registry.js';
import type { CharacterService } from '../character/service.js';

type GuildResult = { readonly ok: true } | { readonly ok: false; readonly code: ErrorCode; readonly message: string };
const fail = (code: ErrorCode, message: string): GuildResult => ({ ok: false, code, message });
const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
};

/** Persisted guild membership; all writes serialize on the character/guild rows and rely on unique indexes. */
export class GuildService {
  constructor(
    private readonly db: Db,
    private readonly charactersService: CharacterService,
    private readonly sessions: SessionRegistry,
  ) {}

  async create(characterId: string, rawName: string): Promise<GuildResult> {
    const parsed = GuildNameSchema.safeParse({ name: rawName });
    if (!parsed.success) {
      return fail(ErrorCode.GUILD_NAME_INVALID, `tên bang phải có 3-${GUILD_NAME_MAX_LENGTH} ký tự chữ, số, dấu cách, gạch dưới hoặc gạch ngang`);
    }
    try {
      await this.db.transaction(async (tx) => {
        await tx.select({ id: characters.id }).from(characters).where(eq(characters.id, characterId)).for('update');
        const [membership] = await tx.select({ id: guildMembers.characterId }).from(guildMembers).where(eq(guildMembers.characterId, characterId)).limit(1);
        if (membership) throw new GuildCommandError(ErrorCode.GUILD_ALREADY_MEMBER, 'bạn đã ở trong một bang rồi');
        const [guild] = await tx.insert(guilds).values({ name: parsed.data.name, leaderCharacterId: characterId }).returning({ id: guilds.id });
        if (!guild) throw new Error('guild insert returned no row');
        await tx.insert(guildMembers).values({ characterId, guildId: guild.id });
      });
    } catch (error) {
      if (error instanceof GuildCommandError) return fail(error.code, error.message);
      if (isUniqueViolation(error)) return fail(ErrorCode.GUILD_NAME_TAKEN, `tên bang "${parsed.data.name}" đã được sử dụng`);
      throw error;
    }
    await this.push(characterId);
    return { ok: true };
  }

  async join(characterId: string, rawName: string): Promise<GuildResult> {
    const parsed = GuildNameSchema.safeParse({ name: rawName });
    if (!parsed.success) {
      return fail(ErrorCode.GUILD_NAME_INVALID, `tên bang phải có 3-${GUILD_NAME_MAX_LENGTH} ký tự chữ, số, dấu cách, gạch dưới hoặc gạch ngang`);
    }
    let guildId: string;
    try {
      guildId = await this.db.transaction(async (tx) => {
        await tx.select({ id: characters.id }).from(characters).where(eq(characters.id, characterId)).for('update');
        const [membership] = await tx.select({ id: guildMembers.characterId }).from(guildMembers).where(eq(guildMembers.characterId, characterId)).limit(1);
        if (membership) throw new GuildCommandError(ErrorCode.GUILD_ALREADY_MEMBER, 'bạn đã ở trong một bang rồi');
        const [guild] = await tx.select({ id: guilds.id }).from(guilds).where(sql`lower(${guilds.name}) = lower(${parsed.data.name})`).for('update').limit(1);
        if (!guild) throw new GuildCommandError(ErrorCode.GUILD_NOT_FOUND, `không tìm thấy bang "${parsed.data.name}"`);
        const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(guildMembers).where(eq(guildMembers.guildId, guild.id));
        if ((countRow?.count ?? 0) >= GUILD_MAX_MEMBERS) throw new GuildCommandError(ErrorCode.GUILD_FULL, `bang đã đủ ${GUILD_MAX_MEMBERS} thành viên`);
        await tx.insert(guildMembers).values({ characterId, guildId: guild.id });
        return guild.id;
      });
    } catch (error) {
      if (error instanceof GuildCommandError) return fail(error.code, error.message);
      if (isUniqueViolation(error)) return fail(ErrorCode.GUILD_ALREADY_MEMBER, 'bạn đã ở trong một bang rồi');
      throw error;
    }
    await this.push(characterId, ...(await this.memberIds(guildId)));
    return { ok: true };
  }

  /** The oldest remaining member becomes leader; an empty guild is deleted with its last member. */
  async leave(characterId: string): Promise<GuildResult> {
    let affected: string[];
    try {
      affected = await this.db.transaction(async (tx) => {
        await tx.select({ id: characters.id }).from(characters).where(eq(characters.id, characterId)).for('update');
        const [membership] = await tx.select({ guildId: guildMembers.guildId }).from(guildMembers).where(eq(guildMembers.characterId, characterId)).limit(1);
        if (!membership) throw new GuildCommandError(ErrorCode.GUILD_NOT_MEMBER, 'bạn chưa ở trong bang nào');
        await tx.select({ id: guilds.id }).from(guilds).where(eq(guilds.id, membership.guildId)).for('update');
        await tx.delete(guildMembers).where(and(eq(guildMembers.characterId, characterId), eq(guildMembers.guildId, membership.guildId)));
        const remaining = await tx.select({ characterId: guildMembers.characterId }).from(guildMembers).where(eq(guildMembers.guildId, membership.guildId)).orderBy(asc(guildMembers.joinedAt), asc(guildMembers.characterId));
        if (remaining.length === 0) {
          await tx.delete(guilds).where(eq(guilds.id, membership.guildId));
        } else {
          const [guild] = await tx.select({ leaderCharacterId: guilds.leaderCharacterId }).from(guilds).where(eq(guilds.id, membership.guildId)).limit(1);
          if (guild?.leaderCharacterId === characterId) {
            await tx.update(guilds).set({ leaderCharacterId: remaining[0]!.characterId }).where(eq(guilds.id, membership.guildId));
          }
        }
        return [characterId, ...remaining.map((member) => member.characterId)];
      });
    } catch (error) {
      if (error instanceof GuildCommandError) return fail(error.code, error.message);
      throw error;
    }
    await this.push(...affected);
    return { ok: true };
  }

  async authorizeChat(characterId: string): Promise<GuildResult> {
    const [membership] = await this.db.select({ guildId: guildMembers.guildId }).from(guildMembers).where(eq(guildMembers.characterId, characterId)).limit(1);
    return membership ? { ok: true } : fail(ErrorCode.GUILD_NOT_MEMBER, 'bạn chưa ở trong bang nào');
  }

  async membersOf(characterId: string): Promise<readonly string[]> {
    const [membership] = await this.db.select({ guildId: guildMembers.guildId }).from(guildMembers).where(eq(guildMembers.characterId, characterId)).limit(1);
    return membership ? this.memberIds(membership.guildId) : [];
  }

  async stateOf(characterId: string): Promise<GuildUpdate> {
    const [membership] = await this.db.select({ guildId: guildMembers.guildId }).from(guildMembers).where(eq(guildMembers.characterId, characterId)).limit(1);
    if (!membership) return { guild: null, maxMembers: GUILD_MAX_MEMBERS };
    const [guild] = await this.db.select().from(guilds).where(eq(guilds.id, membership.guildId)).limit(1);
    if (!guild) return { guild: null, maxMembers: GUILD_MAX_MEMBERS };
    const rows = await this.db.select({ id: characters.id, name: characters.name, level: characters.level, school: characters.school, class: characters.class }).from(guildMembers).innerJoin(characters, eq(guildMembers.characterId, characters.id)).where(eq(guildMembers.guildId, guild.id)).orderBy(asc(guildMembers.joinedAt), asc(guildMembers.characterId));
    const leader = await this.charactersService.findById(guild.leaderCharacterId);
    const members: SocialPerson[] = rows.map((member) => ({
      name: member.name,
      level: member.level,
      school: member.school as SocialPerson['school'],
      class: member.class as SocialPerson['class'],
      online: this.sessions.get(member.id) !== undefined,
    }));
    return {
      guild: {
        id: guild.id,
        name: guild.name,
        level: guild.level,
        exp: guild.exp,
        expToNext: guild.level >= GUILD_MAX_LEVEL ? 0 : GUILD_LEVEL_EXP,
        leaderName: leader?.name ?? 'không rõ',
        members,
      },
      maxMembers: GUILD_MAX_MEMBERS,
    };
  }

  /** One guild receives one 25-XP contribution per boss victory, regardless of member count. */
  async awardBossVictory(characterIds: readonly string[]): Promise<void> {
    if (characterIds.length === 0) return;
    const memberships = await this.db.select({ guildId: guildMembers.guildId }).from(guildMembers).where(inArray(guildMembers.characterId, [...new Set(characterIds)]));
    const guildIds = [...new Set(memberships.map((row) => row.guildId))];
    for (const guildId of guildIds) {
      await this.db.transaction(async (tx) => {
        const [guild] = await tx.select().from(guilds).where(eq(guilds.id, guildId)).for('update').limit(1);
        if (!guild || guild.level >= GUILD_MAX_LEVEL) return;
        let level = guild.level;
        let exp = guild.exp + 25;
        while (level < GUILD_MAX_LEVEL && exp >= GUILD_LEVEL_EXP) {
          exp -= GUILD_LEVEL_EXP;
          level += 1;
        }
        await tx.update(guilds).set({ level, exp: level >= GUILD_MAX_LEVEL ? 0 : exp }).where(eq(guilds.id, guildId));
      });
      await this.push(...(await this.memberIds(guildId)));
    }
  }

  private async memberIds(guildId: string): Promise<string[]> {
    const rows = await this.db.select({ characterId: guildMembers.characterId }).from(guildMembers).where(eq(guildMembers.guildId, guildId));
    return rows.map((row) => row.characterId);
  }

  private async push(...characterIds: string[]): Promise<void> {
    for (const characterId of new Set(characterIds)) {
      this.sessions.get(characterId)?.send(Opcode.S2C_GUILD_UPDATE, await this.stateOf(characterId));
    }
  }
}

class GuildCommandError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}

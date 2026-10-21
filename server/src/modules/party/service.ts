import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  Opcode,
  PARTY_MAX_MEMBERS,
  type Character,
  type PartyUpdate,
  type SocialPerson,
} from '@ninja/shared';
import type { SessionRegistry } from '../../net/session-registry.js';
import type { CharacterService } from '../character/service.js';
import { characterNotFound } from '../social/service.js';

/** Kết quả một lệnh tổ đội; mỗi lý do từ chối có mã riêng như các module khác. */
export type PartyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

function fail(code: ErrorCode, message: string): PartyResult {
  return { ok: false, code, message };
}

/** Một tổ đội trong bộ nhớ: **thứ tự `memberIds` là thứ tự vào đội**, người đầu tiên là đội trưởng. */
interface Party {
  readonly id: string;
  leaderId: string;
  memberIds: string[];
}

/**
 * Tổ đội (M6) — **chỉ trong bộ nhớ**, không có bảng: đội là thứ sống cùng phiên chơi, tắt server thì
 * mất, và không có gì đáng ghi vào database.
 *
 * Lời mời khoá theo `(người nhận, đội trưởng)` và tự mất khi: người nhận từ chối, người nhận vào một
 * đội, hoặc đội trưởng rời/giải tán đội (không thể đồng ý một lời mời của đội không còn).
 *
 * Mọi thay đổi đẩy `S2C_PARTY_UPDATE` cho **mọi thành viên** (kể cả người vừa rời) và cho người nhận
 * lời mời, nên client không phải tự đoán đội của mình.
 */
export class PartyService {
  private readonly parties = new Map<string, Party>();
  private readonly partyOf = new Map<string, string>();
  /** `người nhận` → tập `đội trưởng` đã mời họ. */
  private readonly invites = new Map<string, Set<string>>();

  constructor(
    private readonly characters: CharacterService,
    private readonly sessions: SessionRegistry,
  ) {}

  /** Thành viên cùng kênh tổ đội; không ở đội thì danh sách rỗng. */
  membersOf(characterId: string): readonly string[] {
    const party = this.partyById(this.partyOf.get(characterId));
    return party ? [...party.memberIds] : [];
  }

  /** Trạng thái tổ đội của chính người nhận (kèm lời mời đang chờ). */
  async stateOf(characterId: string): Promise<PartyUpdate> {
    const party = this.partyById(this.partyOf.get(characterId));
    const memberIds = party ? [...party.memberIds] : [];
    const leaders = [...(this.invites.get(characterId) ?? [])];

    const people = await this.characters.findManyByIds([...memberIds, ...leaders]);
    const byId = new Map(people.map((character) => [character.id, character]));

    const members: SocialPerson[] = memberIds
      .map((id) => byId.get(id))
      .filter((character) => character !== undefined)
      .map((character) => this.toPerson(character));

    const invites = leaders
      .map((leaderId) => byId.get(leaderId))
      .filter((character) => character !== undefined)
      .map((leader) => ({ fromName: leader.name, fromLevel: leader.level }))
      .sort((a, b) => a.fromName.localeCompare(b.fromName, 'vi'));

    const leader = party ? byId.get(party.leaderId) : undefined;
    return {
      partyId: party ? party.id : null,
      leaderName: leader ? leader.name : null,
      members,
      invites,
      maxMembers: PARTY_MAX_MEMBERS,
    };
  }

  /**
   * Mời một người vào đội. Người mời **chưa có đội** thì lời mời này lập đội mới với mình làm đội
   * trưởng (đội một người, chưa ai đồng ý thì vẫn là đội của mình).
   */
  async invite(actorId: string, rawName: string): Promise<PartyResult> {
    const target = await this.characters.findByName(rawName);
    if (!target || this.sessions.get(target.id) === undefined) {
      return characterNotFound(rawName);
    }
    if (target.id === actorId) {
      return fail(ErrorCode.PARTY_SELF, 'bạn không thể mời chính mình vào tổ đội');
    }

    const party = this.partyById(this.partyOf.get(actorId));
    if (party && party.leaderId !== actorId) {
      return fail(ErrorCode.PARTY_NOT_LEADER, 'chỉ đội trưởng mới được mời thêm người');
    }
    if (party && party.memberIds.length >= PARTY_MAX_MEMBERS) {
      return fail(ErrorCode.PARTY_FULL, `tổ đội đã đủ ${PARTY_MAX_MEMBERS} người`);
    }
    if (this.partyOf.has(target.id)) {
      return fail(ErrorCode.PARTY_ALREADY_MEMBER, `${target.name} đã ở trong một tổ đội khác`);
    }

    if (!party) {
      this.createParty(actorId);
    }
    this.addInvite(target.id, actorId);

    await this.push(target.id, actorId);
    return { ok: true };
  }

  /** Đồng ý lời mời vào đội của một đội trưởng. */
  async accept(actorId: string, rawLeaderName: string): Promise<PartyResult> {
    const leader = await this.characters.findByName(rawLeaderName);
    if (!leader || !this.hasInvite(actorId, leader.id)) {
      return fail(
        ErrorCode.PARTY_NOT_INVITED,
        `${rawLeaderName.trim()} chưa mời bạn vào tổ đội của họ`,
      );
    }
    if (this.partyOf.has(actorId)) {
      return fail(ErrorCode.PARTY_ALREADY_MEMBER, 'bạn đang ở trong một tổ đội rồi');
    }

    const party = this.partyById(this.partyOf.get(leader.id));
    if (!party || party.leaderId !== leader.id) {
      // Đội trưởng đã rời đội từ lúc gửi lời mời: lời mời này không còn giá trị.
      this.dropInvite(actorId, leader.id);
      return fail(ErrorCode.PARTY_NOT_INVITED, `${leader.name} không còn tổ đội để mời bạn`);
    }
    if (party.memberIds.length >= PARTY_MAX_MEMBERS) {
      return fail(ErrorCode.PARTY_FULL, `tổ đội đã đủ ${PARTY_MAX_MEMBERS} người`);
    }

    // Vào đội thì mọi lời mời khác của người này hết hiệu lực.
    this.dropAllInvitesOf(actorId);
    party.memberIds.push(actorId);
    this.partyOf.set(actorId, party.id);

    await this.push(actorId, ...party.memberIds);
    return { ok: true };
  }

  /** Từ chối lời mời vào đội: chỉ xoá lời mời. */
  async decline(actorId: string, rawLeaderName: string): Promise<PartyResult> {
    const leader = await this.characters.findByName(rawLeaderName);
    if (!leader || !this.hasInvite(actorId, leader.id)) {
      return fail(
        ErrorCode.PARTY_NOT_INVITED,
        `${rawLeaderName.trim()} chưa mời bạn vào tổ đội của họ`,
      );
    }

    this.dropInvite(actorId, leader.id);
    await this.push(actorId, leader.id);
    return { ok: true };
  }

  /** Rời đội. Đội trưởng rời thì chuyển quyền cho người còn lại đầu tiên; hết người thì giải tán. */
  async leave(actorId: string): Promise<PartyResult> {
    const party = this.partyById(this.partyOf.get(actorId));
    if (!party) {
      return fail(ErrorCode.NOT_IN_PARTY, 'bạn không ở trong tổ đội nào');
    }

    const remaining = this.removeMember(party, actorId);
    await this.push(actorId, ...remaining);
    return { ok: true };
  }

  /** Đội trưởng đuổi một thành viên khỏi đội. */
  async kick(actorId: string, rawName: string): Promise<PartyResult> {
    const party = this.partyById(this.partyOf.get(actorId));
    if (!party) {
      return fail(ErrorCode.NOT_IN_PARTY, 'bạn không ở trong tổ đội nào');
    }
    if (party.leaderId !== actorId) {
      return fail(ErrorCode.PARTY_NOT_LEADER, 'chỉ đội trưởng mới được đuổi người');
    }

    const target = await this.characters.findByName(rawName);
    if (target && target.id === actorId) {
      return fail(ErrorCode.PARTY_SELF, 'bạn không thể tự đuổi mình; hãy rời tổ đội');
    }
    if (!target || !party.memberIds.includes(target.id)) {
      return fail(ErrorCode.CHARACTER_NOT_FOUND, `${rawName.trim()} không ở trong tổ đội này`);
    }

    const remaining = this.removeMember(party, target.id);
    await this.push(target.id, ...remaining);
    return { ok: true };
  }

  /**
   * Ngắt kết nối = rời đội (đội là thứ của phiên đang chơi). Không ở đội thì không làm gì.
   */
  async disconnect(characterId: string): Promise<void> {
    if (!this.partyOf.has(characterId)) {
      return;
    }
    await this.leave(characterId);
  }

  /** Đẩy `S2C_PARTY_UPDATE` cho từng nhân vật **đang online** trong danh sách. */
  async push(...characterIds: readonly string[]): Promise<void> {
    for (const characterId of new Set(characterIds)) {
      const session = this.sessions.get(characterId);
      if (!session) {
        continue;
      }
      session.send(Opcode.S2C_PARTY_UPDATE, await this.stateOf(characterId));
    }
  }

  // ------------------------------------------------------------- phần nội bộ

  private toPerson(character: Character): SocialPerson {
    return {
      name: character.name,
      level: character.level,
      school: character.school,
      class: character.class,
      online: this.sessions.get(character.id) !== undefined,
    };
  }

  private partyById(partyId: string | undefined): Party | undefined {
    return partyId === undefined ? undefined : this.parties.get(partyId);
  }

  private createParty(leaderId: string): Party {
    const party: Party = { id: `party:${randomUUID()}`, leaderId, memberIds: [leaderId] };
    this.parties.set(party.id, party);
    this.partyOf.set(leaderId, party.id);
    return party;
  }

  /**
   * Bỏ một người khỏi đội và trả danh sách người **còn lại**. Người cuối cùng rời thì đội giải tán
   * (mọi lời mời của đội đó cũng hết hiệu lực).
   */
  private removeMember(party: Party, characterId: string): string[] {
    party.memberIds = party.memberIds.filter((id) => id !== characterId);
    this.partyOf.delete(characterId);
    this.dropAllInvitesOf(characterId);

    if (party.memberIds.length === 0) {
      this.parties.delete(party.id);
      return [];
    }
    if (party.leaderId === characterId) {
      party.leaderId = party.memberIds[0]!;
    }
    return [...party.memberIds];
  }

  private hasInvite(addresseeId: string, leaderId: string): boolean {
    return this.invites.get(addresseeId)?.has(leaderId) ?? false;
  }

  private addInvite(addresseeId: string, leaderId: string): void {
    const set = this.invites.get(addresseeId) ?? new Set<string>();
    set.add(leaderId);
    this.invites.set(addresseeId, set);
  }

  private dropInvite(addresseeId: string, leaderId: string): void {
    const set = this.invites.get(addresseeId);
    if (!set) {
      return;
    }
    set.delete(leaderId);
    if (set.size === 0) {
      this.invites.delete(addresseeId);
    }
  }

  private dropAllInvitesOf(characterId: string): void {
    this.invites.delete(characterId);
    for (const [addresseeId, leaders] of [...this.invites]) {
      leaders.delete(characterId);
      if (leaders.size === 0) {
        this.invites.delete(addresseeId);
      }
    }
  }
}

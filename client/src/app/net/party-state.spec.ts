import { TestBed } from '@angular/core/testing';
import { PARTY_MAX_MEMBERS, Opcode, type PartyUpdate, type SocialPerson } from '@ninja/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyState } from './party-state';

function person(overrides: Partial<SocialPerson> = {}): SocialPerson {
  return {
    name: 'Sasuke',
    level: 5,
    school: 'haruna',
    class: 'dao',
    online: true,
    ...overrides,
  };
}

function update(overrides: Partial<PartyUpdate> = {}): PartyUpdate {
  return {
    partyId: null,
    leaderName: null,
    members: [],
    invites: [],
    maxMembers: PARTY_MAX_MEMBERS,
    ...overrides,
  };
}

describe('PartyState', () => {
  let party: PartyState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    party = TestBed.inject(PartyState);
  });

  it('bắt đầu không ở đội nào nhưng đã biết trần số thành viên', () => {
    expect(party.partyId()).toBeNull();
    expect(party.leaderName()).toBeNull();
    expect(party.members()).toEqual([]);
    expect(party.invites()).toEqual([]);
    expect(party.maxMembers()).toBe(PARTY_MAX_MEMBERS);
    expect(party.inParty()).toBe(false);
  });

  it('S2C_PARTY_UPDATE giữ id đội, đội trưởng và thành viên', () => {
    expect(
      party.applyPacket(
        Opcode.S2C_PARTY_UPDATE,
        update({
          partyId: 'party-1',
          leaderName: 'Kakashi',
          members: [person({ name: 'Kakashi', level: 9 }), person({ name: 'Naruto', level: 3 })],
        }),
      ),
    ).toBe(true);

    expect(party.inParty()).toBe(true);
    expect(party.partyId()).toBe('party-1');
    expect(party.leaderName()).toBe('Kakashi');
    expect(party.members().map((member) => member.name)).toEqual(['Kakashi', 'Naruto']);
  });

  it('isLeader() so tên nhân vật đang chơi với đội trưởng', () => {
    party.applyPacket(
      Opcode.S2C_PARTY_UPDATE,
      update({ partyId: 'party-1', leaderName: 'Kakashi', members: [person()] }),
    );

    expect(party.isLeader('Kakashi')).toBe(true);
    expect(party.isLeader('Naruto')).toBe(false);
    // Chưa biết tên mình (chưa có S2C_CHARACTER) thì không ai là đội trưởng — đừng đoán.
    expect(party.isLeader(null)).toBe(false);
  });

  it('không ở đội thì không ai là đội trưởng, kể cả khi lời mời còn đó', () => {
    party.applyPacket(
      Opcode.S2C_PARTY_UPDATE,
      update({ invites: [{ fromName: 'Kakashi', fromLevel: 9 }] }),
    );

    expect(party.invites().map((invite) => invite.fromName)).toEqual(['Kakashi']);
    expect(party.inParty()).toBe(false);
    expect(party.isLeader('Kakashi')).toBe(false);
  });

  it('người khác rời đội thì danh sách thành viên co lại theo gói mới', () => {
    party.applyPacket(
      Opcode.S2C_PARTY_UPDATE,
      update({ partyId: 'party-1', leaderName: 'Kakashi', members: [person({ name: 'Kakashi' })] }),
    );

    expect(party.members()).toHaveLength(1);
  });

  it('bỏ qua gói không thuộc phần tổ đội và xoá sạch khi reset()', () => {
    expect(party.applyPacket(Opcode.S2C_SOCIAL_UPDATE, {})).toBe(false);

    party.applyPacket(
      Opcode.S2C_PARTY_UPDATE,
      update({ partyId: 'party-1', leaderName: 'Kakashi' }),
    );
    party.reset();

    expect(party.partyId()).toBeNull();
    expect(party.leaderName()).toBeNull();
  });
});

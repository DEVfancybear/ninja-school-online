import { TestBed } from '@angular/core/testing';
import { MAX_FRIENDS, Opcode, type SocialPerson, type SocialUpdate } from '@ninja/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { SocialState } from './social-state';

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

function update(overrides: Partial<SocialUpdate> = {}): SocialUpdate {
  return { friends: [], incoming: [], outgoing: [], maxFriends: MAX_FRIENDS, ...overrides };
}

describe('SocialState', () => {
  let social: SocialState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    social = TestBed.inject(SocialState);
  });

  it('bắt đầu rỗng nhưng đã biết trần số bạn của luật', () => {
    expect(social.friends()).toEqual([]);
    expect(social.incoming()).toEqual([]);
    expect(social.outgoing()).toEqual([]);
    expect(social.maxFriends()).toBe(MAX_FRIENDS);
    expect(social.incomingCount()).toBe(0);
  });

  it('S2C_SOCIAL_UPDATE thay cả ba danh sách cùng lúc', () => {
    const payload = update({
      friends: [person()],
      incoming: [person({ name: 'Naruto', level: 3, online: false })],
      outgoing: [person({ name: 'Sakura' })],
    });

    expect(social.applyPacket(Opcode.S2C_SOCIAL_UPDATE, payload)).toBe(true);

    expect(social.friends().map((friend) => friend.name)).toEqual(['Sasuke']);
    expect(social.friends()[0]?.online).toBe(true);
    expect(social.incoming().map((friend) => friend.name)).toEqual(['Naruto']);
    // Trạng thái online của người khác do server quyết, client chỉ giữ đúng cờ nhận được.
    expect(social.incoming()[0]?.online).toBe(false);
    expect(social.outgoing().map((friend) => friend.name)).toEqual(['Sakura']);
  });

  it('đếm lời mời đang chờ nhận để HUD có số mà hiện', () => {
    social.applyPacket(
      Opcode.S2C_SOCIAL_UPDATE,
      update({ incoming: [person(), person({ name: 'Naruto' })] }),
    );

    expect(social.incomingCount()).toBe(2);
  });

  it('danh sách mới thay hẳn danh sách cũ, không cộng dồn', () => {
    social.applyPacket(Opcode.S2C_SOCIAL_UPDATE, update({ friends: [person()] }));
    social.applyPacket(Opcode.S2C_SOCIAL_UPDATE, update({ friends: [] }));

    // Bỏ bạn thành công: server gửi lại danh sách đã trừ người, client không được giữ lại người cũ.
    expect(social.friends()).toEqual([]);
  });

  it('bỏ qua gói không thuộc phần xã hội và xoá sạch khi reset()', () => {
    expect(social.applyPacket(Opcode.S2C_PARTY_UPDATE, {})).toBe(false);

    social.applyPacket(Opcode.S2C_SOCIAL_UPDATE, update({ friends: [person()] }));
    social.reset();

    expect(social.friends()).toEqual([]);
  });
});

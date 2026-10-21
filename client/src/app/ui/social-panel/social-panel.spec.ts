import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAX_FRIENDS,
  PARTY_MAX_MEMBERS,
  type PartyUpdate,
  type SocialPerson,
  type SocialUpdate,
} from '@ninja/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SocialPanel } from './social-panel';

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

function socialUpdate(overrides: Partial<SocialUpdate> = {}): SocialUpdate {
  return { friends: [], incoming: [], outgoing: [], maxFriends: MAX_FRIENDS, ...overrides };
}

function partyUpdate(overrides: Partial<PartyUpdate> = {}): PartyUpdate {
  return {
    partyId: null,
    leaderName: null,
    members: [],
    invites: [],
    maxMembers: PARTY_MAX_MEMBERS,
    ...overrides,
  };
}

describe('SocialPanel', () => {
  let fixture: ComponentFixture<SocialPanel> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  async function setup(options: {
    social?: SocialUpdate;
    party?: PartyUpdate;
    selfName?: string;
  }): Promise<ComponentFixture<SocialPanel>> {
    await TestBed.configureTestingModule({ imports: [SocialPanel] }).compileComponents();
    const created = TestBed.createComponent(SocialPanel);
    const social = options.social ?? socialUpdate();
    created.componentRef.setInput('friends', social.friends);
    created.componentRef.setInput('incoming', social.incoming);
    created.componentRef.setInput('outgoing', social.outgoing);
    created.componentRef.setInput('maxFriends', social.maxFriends);
    created.componentRef.setInput('party', options.party ?? partyUpdate());
    created.componentRef.setInput('selfName', options.selfName ?? 'Kakashi');
    created.detectChanges();
    return created;
  }

  function element(): HTMLElement {
    return fixture?.nativeElement as HTMLElement;
  }

  function click(selector: string): void {
    const target = element().querySelector<HTMLElement>(selector);
    expect(target, `không thấy ${selector}`).not.toBeNull();
    target?.click();
    fixture?.detectChanges();
  }

  function type(selector: string, value: string): void {
    const input = element().querySelector<HTMLInputElement>(selector);
    expect(input, `không thấy ${selector}`).not.toBeNull();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    fixture?.detectChanges();
  }

  /** Gửi form bằng sự kiện `submit` (nút `type=submit` cần trình duyệt thật mới tự phát). */
  function submit(selector: string): void {
    const form = element().querySelector<HTMLFormElement>(selector);
    expect(form, `không thấy ${selector}`).not.toBeNull();
    form?.dispatchEvent(new Event('submit'));
    fixture?.detectChanges();
  }

  it('mở ở thẻ bạn bè, liệt kê bạn kèm trạng thái và đếm trên trần', async () => {
    fixture = await setup({
      social: socialUpdate({
        friends: [person(), person({ name: 'Naruto', level: 3, online: false })],
        incoming: [person({ name: 'Sakura' })],
        outgoing: [person({ name: 'Hinata' })],
      }),
    });

    expect(element().querySelector('.social-panel')).not.toBeNull();
    expect(element().querySelector('.social-tab--friends')?.textContent).toContain(
      `Bạn bè (2/${MAX_FRIENDS})`,
    );
    expect(
      [...element().querySelectorAll('.social-friend__name')].map((row) => row.textContent?.trim()),
    ).toEqual(['Sasuke', 'Naruto']);
    expect(element().querySelectorAll('.social-incoming__row')).toHaveLength(1);
    expect(element().querySelector('.social-outgoing')?.textContent).toContain('Hinata');
  });

  it('gửi lời mời kết bạn bằng tên vừa gõ, và nút bị khoá khi ô còn trống', async () => {
    fixture = await setup({});
    const emitted: string[] = [];
    fixture.componentInstance.friendRequest.subscribe((name) => emitted.push(name));

    expect(element().querySelector<HTMLButtonElement>('.social-add-submit')?.disabled).toBe(true);

    type('.social-add-input', '  Sasuke  ');
    submit('.social-add');

    // Tên được cắt khoảng trắng trước khi gửi; gửi xong thì ô nhập rỗng lại.
    expect(emitted).toEqual(['Sasuke']);
    expect(element().querySelector<HTMLInputElement>('.social-add-input')?.value).toBe('');
  });

  it('nhận hoặc từ chối lời mời kết bạn đúng người ở dòng đó', async () => {
    fixture = await setup({
      social: socialUpdate({
        incoming: [person({ name: 'Sakura' }), person({ name: 'Naruto' })],
      }),
    });
    const accepted: string[] = [];
    const declined: string[] = [];
    fixture.componentInstance.friendAccept.subscribe((name) => accepted.push(name));
    fixture.componentInstance.friendDecline.subscribe((name) => declined.push(name));

    click('.social-incoming__row:nth-child(2) .social-incoming__accept');
    click('.social-incoming__row:nth-child(1) .social-incoming__decline');

    expect(accepted).toEqual(['Naruto']);
    expect(declined).toEqual(['Sakura']);
  });

  it('bỏ bạn thì phát tên của dòng bị bấm', async () => {
    fixture = await setup({ social: socialUpdate({ friends: [person({ name: 'Sasuke' })] }) });
    const removed: string[] = [];
    fixture.componentInstance.friendRemove.subscribe((name) => removed.push(name));

    click('.social-friend__remove');

    expect(removed).toEqual(['Sasuke']);
  });

  it('chưa có bạn nào thì hiện dòng trống thay vì danh sách trắng', async () => {
    fixture = await setup({ social: socialUpdate({ friends: [] }) });

    expect(element().querySelector('.social-friend--empty')).not.toBeNull();
  });

  it('thẻ tổ đội: chưa ở đội thì hiện .party-empty và vẫn mời được người', async () => {
    fixture = await setup({ party: partyUpdate() });
    const invited: string[] = [];
    fixture.componentInstance.partyInvite.subscribe((name) => invited.push(name));

    click('.social-tab--party');

    expect(element().querySelector('.party-panel')).not.toBeNull();
    expect(element().querySelector('.party-empty')).not.toBeNull();
    expect(element().querySelector('.party-leave')).toBeNull();

    type('.party-invite-input', 'Naruto');
    submit('.party-invite');

    expect(invited).toEqual(['Naruto']);
  });

  it('lời mời vào đội hiện đúng người mời và trả lời được', async () => {
    fixture = await setup({
      party: partyUpdate({ invites: [{ fromName: 'Kakashi', fromLevel: 9 }] }),
    });
    const accepted: string[] = [];
    const declined: string[] = [];
    fixture.componentInstance.partyAccept.subscribe((name) => accepted.push(name));
    fixture.componentInstance.partyDecline.subscribe((name) => declined.push(name));

    click('.social-tab--party');
    expect(element().querySelectorAll('.party-invite-row')).toHaveLength(1);
    click('.party-invite-accept');

    expect(accepted).toEqual(['Kakashi']);

    click('.party-invite-decline');
    expect(declined).toEqual(['Kakashi']);
  });

  it('đội trưởng thấy nút đuổi ở mọi thành viên khác, không thấy trên chính mình', async () => {
    fixture = await setup({
      selfName: 'Kakashi',
      party: partyUpdate({
        partyId: 'party-1',
        leaderName: 'Kakashi',
        members: [person({ name: 'Kakashi' }), person({ name: 'Naruto' })],
      }),
    });

    click('.social-tab--party');

    const rows = [...element().querySelectorAll('.party-member')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.party-kick')).toBeNull();
    expect(rows[1]?.querySelector('.party-kick')).not.toBeNull();
  });

  it('thành viên thường không thấy nút đuổi ai', async () => {
    fixture = await setup({
      selfName: 'Naruto',
      party: partyUpdate({
        partyId: 'party-1',
        leaderName: 'Kakashi',
        members: [person({ name: 'Kakashi' }), person({ name: 'Naruto' })],
      }),
    });

    click('.social-tab--party');

    expect(element().querySelector('.party-kick')).toBeNull();
  });

  it('đuổi thành viên và rời đội phát đúng ý định', async () => {
    fixture = await setup({
      selfName: 'Kakashi',
      party: partyUpdate({
        partyId: 'party-1',
        leaderName: 'Kakashi',
        members: [person({ name: 'Kakashi' }), person({ name: 'Naruto' })],
      }),
    });
    const kicked: string[] = [];
    let left = 0;
    fixture.componentInstance.partyKick.subscribe((name) => kicked.push(name));
    fixture.componentInstance.partyLeave.subscribe(() => (left += 1));

    click('.social-tab--party');
    click('.party-kick');
    click('.party-leave');

    expect(kicked).toEqual(['Naruto']);
    expect(left).toBe(1);
  });

  it('nút đóng phát `closed` để trang đóng bảng', async () => {
    fixture = await setup({});
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    click('.social-panel__close');

    expect(closed).toBe(1);
  });

  it('đổi thẻ thì đổi nội dung, thẻ đang xem được đánh dấu', async () => {
    fixture = await setup({ social: socialUpdate({ friends: [person()] }) });

    expect(element().querySelector('.party-panel')).toBeNull();
    click('.social-tab--party');
    expect(element().querySelector('.party-panel')).not.toBeNull();
    expect(element().querySelector('.social-tab--party')?.className).toContain(
      'social-tab--active',
    );

    click('.social-tab--friends');
    expect(element().querySelector('.party-panel')).toBeNull();
    expect(element().querySelector('.social-friend')).not.toBeNull();
  });
});

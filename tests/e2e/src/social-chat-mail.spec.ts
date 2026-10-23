import { expect, test, type Page } from '@playwright/test';

/**
 * Xã hội & hộp thư (M6): hai người chơi thật trên hai trình duyệt riêng — kết bạn, lập tổ đội, chat
 * bốn kênh (kể cả giới hạn 5 giây của kênh thế giới) và nhận quà trong thư.
 *
 * Mọi khẳng định đều đọc trạng thái qua hook `__ninjaWorld` (bản chụp dữ liệu client đang giữ) hoặc
 * qua đúng lớp CSS của giao diện; không có bài nào chỉ kiểm "không ném lỗi".
 */

const PASSWORD = 'matkhau123';
const START_MAP_NAME = 'Làng Khởi Nguồn';
const WELCOME_MAIL_YEN = 100;
const WELCOME_MAIL_ITEM = 'Bánh Bao Hấp';

test.describe.configure({ timeout: 240_000 });

interface HookPerson {
  readonly name: string;
  readonly level: number;
  readonly online: boolean;
}

interface HookSocial {
  readonly friends: readonly HookPerson[];
  readonly incoming: readonly HookPerson[];
  readonly outgoing: readonly HookPerson[];
  readonly maxFriends: number;
}

interface HookParty {
  readonly partyId: string | null;
  readonly leaderName: string | null;
  readonly members: readonly HookPerson[];
  readonly invites: readonly { readonly fromName: string }[];
  readonly maxMembers: number;
}

interface HookMail {
  readonly id: string;
  readonly subject: string;
  readonly claimed: boolean;
  readonly yen: number;
  readonly items: readonly { readonly name: string; readonly qty: number }[];
}

interface HookCharacter {
  readonly level: number;
  readonly exp: number;
  readonly yen: number;
}

interface HookItem {
  readonly name: string;
  readonly quantity: number;
}

interface HookBattle {
  readonly isMyTurn: boolean;
  readonly outcome: string | null;
  readonly mode: string;
}

interface HookMonster {
  readonly name: string;
  readonly alive: boolean;
}

interface HookApi {
  readonly character: () => HookCharacter | null;
  readonly inventory: () => readonly HookItem[];
  readonly battle: () => HookBattle | null;
  readonly social: () => HookSocial;
  readonly party: () => HookParty;
  readonly mails: () => readonly HookMail[];
  readonly lastError: () => string | null;
  readonly clickEntity: (name: string) => void;
  readonly attackMonster: (name: string) => void;
  readonly monsters: () => readonly HookMonster[];
}

/** Gọi một hook của client; chưa có hook (trang còn đang tải) thì trả `null`. */
async function hook<T>(page: Page, name: string): Promise<T | null> {
  return page.evaluate((hookName) => {
    const api = (globalThis as unknown as { __ninjaWorld?: Record<string, unknown> }).__ninjaWorld;
    const fn = api?.[hookName];
    return typeof fn === 'function' ? (fn as () => unknown)() : null;
  }, name) as Promise<T | null>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

/** Đăng ký tài khoản mới, tạo nhân vật và vào thế giới; trả về tên nhân vật. */
async function enterWorld(page: Page, prefix: string): Promise<string> {
  const suffix = uniqueSuffix();
  const username = `${prefix.toLowerCase()}${suffix}`;
  const characterName = `${prefix}${suffix.slice(-4)}`;

  await page.goto('/login');
  await page.locator('.tab', { hasText: 'Tạo tài khoản' }).click();
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/characters$/);

  await page.fill('#character-name', characterName);
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('.list .card h2')).toHaveText(characterName);

  await page.goto('/play');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud .map-name')).toHaveText(START_MAP_NAME);
  await expect.poll(async () => (await hook<HookSocial>(page, 'social')) !== null).toBe(true);
  return characterName;
}

async function social(page: Page): Promise<HookSocial> {
  const value = await hook<HookSocial>(page, 'social');
  if (!value) {
    throw new Error('client chưa có hook social()');
  }
  return value;
}

async function party(page: Page): Promise<HookParty> {
  const value = await hook<HookParty>(page, 'party');
  if (!value) {
    throw new Error('client chưa có hook party()');
  }
  return value;
}

async function mails(page: Page): Promise<readonly HookMail[]> {
  const value = await hook<readonly HookMail[]>(page, 'mails');
  if (!value) {
    throw new Error('client chưa có hook mails()');
  }
  return value;
}

async function character(page: Page): Promise<HookCharacter> {
  const value = await hook<HookCharacter>(page, 'character');
  if (!value) {
    throw new Error('client chưa có hook character()');
  }
  return value;
}

/** Bấm nút HUD để mở/đóng một bảng, chỉ bấm khi trạng thái chưa đúng. */
async function togglePanel(page: Page, hudClass: string, panelClass: string, open: boolean) {
  const panel = page.locator(panelClass);
  const isOpen = await panel.isVisible();
  if (isOpen !== open) {
    await page.locator(hudClass).click();
  }
  if (open) {
    await expect(panel).toBeVisible();
  } else {
    await expect(panel).toBeHidden();
  }
}

test.describe('xã hội: bạn bè, tổ đội, hộp thư', () => {
  test('hai người chơi kết bạn, lập tổ đội rồi rời đội; nhận quà trong thư', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    try {
      const nameA = await enterWorld(pageA, 'S6');
      const nameB = await enterWorld(pageB, 'S6');

      // A mời kết bạn theo tên; B thấy lời mời và đồng ý.
      await togglePanel(pageA, '.hud__social', '.social-panel', true);
      await pageA.fill('.social-add-input', nameB);
      await pageA.locator('.social-add-submit').click();
      await expect
        .poll(async () => (await social(pageA)).outgoing.map((person) => person.name))
        .toContain(nameB);

      await togglePanel(pageB, '.hud__social', '.social-panel', true);
      await expect(pageB.locator('.social-incoming__row')).toContainText(nameA);
      await pageB.locator('.social-incoming__accept').click();
      await expect
        .poll(async () => (await social(pageB)).friends.map((person) => person.name))
        .toContain(nameA);
      // A thấy B trong danh sách bạn mà không phải tải lại trang.
      await expect
        .poll(async () => (await social(pageA)).friends.map((person) => person.name))
        .toContain(nameB);
      const friend = (await social(pageA)).friends.find((person) => person.name === nameB);
      expect(friend?.online).toBe(true);

      // A (đang là trưởng nhóm) mời B vào tổ đội; B đồng ý.
      await pageA.locator('.social-tab--party').click();
      await pageA.fill('.party-invite-input', nameB);
      await pageA.locator('.party-invite-submit').click();
      await expect
        .poll(async () => (await party(pageB)).invites.map((invite) => invite.fromName))
        .toContain(nameA);

      await pageB.locator('.social-tab--party').click();
      await expect(pageB.locator('.party-invite-row')).toContainText(nameA);
      await pageB.locator('.party-invite-accept').click();
      await expect
        .poll(async () => (await party(pageB)).members.map((member) => member.name).sort())
        .toEqual([nameA, nameB].sort());
      await expect
        .poll(async () => (await party(pageA)).members.map((member) => member.name).sort())
        .toEqual([nameA, nameB].sort());
      expect((await party(pageA)).leaderName).toBe(nameA);
      await expect(pageA.locator('.party-member')).toHaveCount(2);
      await expect(pageB.locator('.party-member')).toHaveCount(2);

      // B rời đội: A còn một mình, B không còn đội.
      await pageB.locator('.party-leave').click();
      await expect.poll(async () => (await party(pageB)).partyId).toBeNull();
      await expect
        .poll(async () => (await party(pageA)).members.map((member) => member.name))
        .toEqual([nameA]);
      await expect(pageB.locator('.party-empty')).toBeVisible();

      // A mở hộp thư: có thư chào mừng, nhận quà cộng yên và vật phẩm, thư chuyển sang "đã nhận".
      const before = await character(pageA);
      const bagBefore = (await hook<readonly HookItem[]>(pageA, 'inventory')) ?? [];
      const baoBefore = bagBefore
        .filter((item) => item.name === WELCOME_MAIL_ITEM)
        .reduce((sum, item) => sum + item.quantity, 0);

      await togglePanel(pageA, '.hud__social', '.social-panel', false);
      await togglePanel(pageA, '.hud__mail', '.mail-panel', true);
      await expect(pageA.locator('.mail-item__subject')).toContainText('Thư chào mừng');
      const welcome = (await mails(pageA)).find((mail) => mail.subject === 'Thư chào mừng');
      expect(welcome?.yen).toBe(WELCOME_MAIL_YEN);
      expect(welcome?.claimed).toBe(false);

      await pageA
        .locator('.mail-item')
        .filter({ hasText: 'Thư chào mừng' })
        .locator('.mail-claim')
        .click();
      await expect
        .poll(
          async () =>
            (await mails(pageA)).find((mail) => mail.subject === 'Thư chào mừng')?.claimed,
        )
        .toBe(true);
      await expect(pageA.locator('.mail-item--claimed')).toHaveCount(1);
      await expect
        .poll(async () => (await character(pageA)).yen)
        .toBe(before.yen + WELCOME_MAIL_YEN);
      await expect
        .poll(async () => {
          const bag = (await hook<readonly HookItem[]>(pageA, 'inventory')) ?? [];
          return bag
            .filter((item) => item.name === WELCOME_MAIL_ITEM)
            .reduce((sum, item) => sum + item.quantity, 0);
        })
        .toBe(baoBefore + 1);
      // Thư đã nhận thì không còn nút nhận quà bấm được (gỡ hẳn hay khoá đều đạt).
      await expect(pageA.locator('.mail-item--claimed .mail-claim:enabled')).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('mời một cái tên không tồn tại bị từ chối bằng đúng mã lỗi', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await enterWorld(page, 'S6');
      await togglePanel(page, '.hud__social', '.social-panel', true);
      await page.fill('.social-add-input', 'KhongCoAi');
      await page.locator('.social-add-submit').click();
      await expect(page.locator('.notice-bar')).toContainText(/không tìm thấy/i);
      expect((await social(page)).outgoing).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe('chat nhiều kênh', () => {
  test('thế giới, tổ đội và tin riêng tới đúng người; kênh thế giới bị giới hạn 5 giây', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    try {
      const nameA = await enterWorld(pageA, 'S6');
      const nameB = await enterWorld(pageB, 'S6');

      const stamp = Date.now().toString().slice(-5);
      const worldFirst = `thế giới ${stamp}`;
      await pageA.selectOption('.chat-channel', 'world');
      await pageA.fill('.chat-input', worldFirst);
      await pageA.locator('.chat-send').click();
      await expect(pageB.locator('.chat-line--world')).toContainText(worldFirst);
      // Người gửi cũng thấy tin của mình trên kênh thế giới.
      await expect(pageA.locator('.chat-line--world')).toContainText(worldFirst);

      // Gửi tiếp ngay: server chặn vì kênh thế giới giãn cách 5 giây mỗi người.
      const worldSecond = `thế giới lần hai ${stamp}`;
      await pageA.fill('.chat-input', worldSecond);
      await pageA.locator('.chat-send').click();
      await expect(pageA.locator('.chat-notice')).toContainText(/5 giây/);
      // Kênh thế giới là của cả server nên đếm theo nội dung, không đếm tổng số dòng.
      await expect(pageB.locator('.chat-line--world', { hasText: worldSecond })).toHaveCount(0);

      // Lập tổ đội rồi chat nhóm: chỉ thành viên nhận được, không lọt sang người ngoài.
      await togglePanel(pageA, '.hud__social', '.social-panel', true);
      await pageA.locator('.social-tab--party').click();
      await pageA.fill('.party-invite-input', nameB);
      await pageA.locator('.party-invite-submit').click();
      await togglePanel(pageA, '.hud__social', '.social-panel', false);
      await togglePanel(pageB, '.hud__social', '.social-panel', true);
      await pageB.locator('.social-tab--party').click();
      await expect(pageB.locator('.party-invite-row')).toContainText(nameA);
      await pageB.locator('.party-invite-accept').click();
      await togglePanel(pageB, '.hud__social', '.social-panel', false);
      await expect
        .poll(async () => (await party(pageB)).members.map((member) => member.name).sort())
        .toEqual([nameA, nameB].sort());

      const partyText = `nhóm ${stamp}`;
      await pageA.selectOption('.chat-channel', 'party');
      await pageA.fill('.chat-input', partyText);
      await pageA.locator('.chat-send').click();
      await expect(pageB.locator('.chat-line--party')).toContainText(partyText);
      // Không phải tin thế giới nên không bị tính vào hạn 5 giây của kênh thế giới.
      await expect(pageB.locator('.chat-line--world', { hasText: worldSecond })).toHaveCount(0);

      // Tin riêng: cả người gửi và người nhận đều thấy, có tên người nhận.
      const privateText = `riêng ${stamp}`;
      await pageA.selectOption('.chat-channel', 'private');
      await expect(pageA.locator('.chat-target')).toBeVisible();
      await pageA.fill('.chat-target', nameB);
      await pageA.fill('.chat-input', privateText);
      await pageA.locator('.chat-send').click();
      await expect(pageB.locator('.chat-line--private')).toContainText(privateText);
      await expect(pageB.locator('.chat-line--private')).toContainText(nameA);
      await expect(pageA.locator('.chat-line--private')).toContainText(privateText);
      await expect(pageA.locator('.chat-line--private')).toContainText(nameB);

      // Người nhận không tồn tại: server trả lỗi và không có tin nào được gửi.
      await pageA.fill('.chat-target', 'KhongCoAi');
      await pageA.fill('.chat-input', 'thử người lạ');
      await pageA.locator('.chat-send').click();
      await expect(pageA.locator('.chat-notice')).toContainText(/không tìm thấy/i);
      await expect(pageA.locator('.chat-line--private')).toHaveCount(1);

      // Hết 5 giây thì kênh thế giới gửi được tiếp.
      await pageA.selectOption('.chat-channel', 'world');
      const worldThird = `thế giới lần ba ${stamp}`;
      // Đồng hồ giãn cách là của server, nên chờ đủ 5 giây rồi mới gửi lại.
      await pageA.waitForTimeout(5_200);
      await pageA.fill('.chat-input', worldThird);
      await pageA.locator('.chat-send').click();
      await expect(pageB.locator('.chat-line--world', { hasText: worldThird })).toHaveCount(1);
      // Tin chặn lúc nãy không bao giờ được phát đi.
      await expect(pageB.locator('.chat-line--world', { hasText: worldSecond })).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

test.describe('đánh quái trong làng để lấy kinh nghiệm', () => {
  test('hạ một con chuột đồng là đủ lên cấp 3 (mốc mở Lôi Đài)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await enterWorld(page, 'S6');
      const before = await character(page);
      expect(before.level).toBe(1);

      await expect
        .poll(
          async () => {
            const monsters = (await hook<readonly HookMonster[]>(page, 'monsters')) ?? [];
            return monsters.some((monster) => monster.name === 'Chuột Đồng' && monster.alive);
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      await page.evaluate(() => {
        const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
        api?.attackMonster('Chuột Đồng');
      });
      const attack = page.getByRole('button', { name: 'Đánh thường' });
      const deadline = Date.now() + 60_000;
      for (;;) {
        if (Date.now() > deadline) {
          throw new Error('trận với chuột đồng không kết thúc trong 60 giây');
        }
        const current = await hook<HookBattle>(page, 'battle');
        if (!current) {
          await page.waitForTimeout(300);
          continue;
        }
        if (current.outcome) {
          break;
        }
        if (current.isMyTurn) {
          await attack.click({ timeout: 2_000 }).catch(() => undefined);
        }
        await page.waitForTimeout(120);
      }
      await page.locator('.result').getByRole('button', { name: 'Đóng' }).click();
      await expect.poll(async () => (await character(page)).level, { timeout: 15_000 }).toBe(3);
    } finally {
      await context.close();
    }
  });
});

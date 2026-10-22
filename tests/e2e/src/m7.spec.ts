import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Ninja!Test123';
const START_MAP_NAME = 'Làng Khởi Nguồn';

test.describe.configure({ timeout: 240_000 });

interface HookM7 {
  readonly event: {
    readonly enabled: boolean;
    readonly utcDay: string;
    readonly loginClaimed: boolean;
    readonly quest: { readonly progress: number; readonly target: number; readonly complete: boolean };
  };
  readonly boss: {
    readonly active: boolean;
    readonly mapId: string;
    readonly windowStartsAt: number;
    readonly windowEndsAt: number;
    readonly dailyLootClaimed: boolean;
  };
}
interface HookGuild {
  readonly guild: null | {
    readonly name: string;
    readonly level: number;
    readonly exp: number;
    readonly expToNext: number;
    readonly members: readonly { readonly name: string; readonly online: boolean }[];
  };
}
async function uniqueSuffix(): Promise<string> {
  return `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function enterWorld(page: Page, prefix: string, suffix: string): Promise<string> {
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
  await expect(page.locator('.hud .map-name')).toHaveText(START_MAP_NAME);
  await expect.poll(async () => (await hook<HookM7>(page, 'm7')) !== null).toBe(true);
  return characterName;
}

async function hook<T>(page: Page, method: string): Promise<T | null> {
  return page.evaluate((key) => {
    const api = (globalThis as unknown as { __ninjaWorld?: Record<string, unknown> }).__ninjaWorld;
    const fn = api?.[key];
    return typeof fn === 'function' ? (fn as () => unknown)() as T : null;
  }, method);
}

async function openGuild(page: Page): Promise<void> {
  await page.locator('.hud__guild').click();
  await expect(page.locator('.guild-panel')).toBeVisible();
}

async function openM7(page: Page): Promise<void> {
  await page.locator('.hud__m7').click();
  await expect(page.locator('.m7-panel')).toBeVisible();
}

test('M7: three guild members chat together and first event login reward is claimable once', async ({ browser }) => {
  const suffix = await uniqueSuffix();
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const names = await Promise.all([
      enterWorld(pages[0]!, 'G7A', suffix),
      enterWorld(pages[1]!, 'G7B', suffix),
      enterWorld(pages[2]!, 'G7C', suffix),
    ]);

    await openM7(pages[0]!);
    await expect.poll(async () => (await hook<HookM7>(pages[0]!, 'm7'))?.event.enabled).toBe(true);
    const m7 = (await hook<HookM7>(pages[0]!, 'm7'))!;
    expect(m7.event.utcDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m7.event.quest).toMatchObject({ progress: 0, target: 1, complete: false });
    expect(m7.boss.mapId).toBe('lang-khoi-nguon');
    expect(m7.boss.windowEndsAt).toBeGreaterThan(m7.boss.windowStartsAt);
    await pages[0]!.getByRole('button', { name: 'Nhận quà đăng nhập' }).click();
    await expect.poll(async () => (await hook<HookM7>(pages[0]!, 'm7'))?.event.loginClaimed).toBe(true);
    await expect(pages[0]!.getByRole('button', { name: 'Đã nhận quà hôm nay' })).toBeDisabled();
    await pages[0]!.getByRole('button', { name: 'Đóng bảng sự kiện' }).click();
    await pages[0]!.locator('.hud__mail').click();
    await expect(pages[0]!.locator('.mail-item__subject', { hasText: 'Quà đăng nhập sự kiện' })).toBeVisible();

    const guildName = `Bang${suffix.slice(-5)}`;
    await openGuild(pages[0]!);
    await pages[0]!.locator('#guild-create-name').fill(guildName);
    await pages[0]!.locator('.guild-panel form').first().getByRole('button', { name: 'Tạo bang' }).click();
    await expect.poll(async () => (await hook<HookGuild>(pages[0]!, 'guild'))?.guild?.name).toBe(guildName);

    for (const index of [1, 2]) {
      await openGuild(pages[index]!);
      await pages[index]!.locator('#guild-join-name').fill(guildName);
      await pages[index]!.locator('.guild-panel form').nth(1).getByRole('button', { name: 'Gia nhập' }).click();
      await expect.poll(async () => (await hook<HookGuild>(pages[index]!, 'guild'))?.guild?.members.length).toBe(index + 1);
    }
    for (const page of pages) {
      await expect.poll(async () => (await hook<HookGuild>(page, 'guild'))?.guild?.members.map((member) => member.name).sort())
        .toEqual([...names].sort());
    }

    const message = `bang-m7-${suffix}`;
    await pages[0]!.locator('.chat-channel').selectOption('guild');
    await pages[0]!.locator('.chat-input').fill(message);
    await pages[0]!.locator('.chat-send').click();
    for (const page of pages.slice(1)) {
      await expect(page.locator('.chat-line').filter({ hasText: message })).toBeVisible();
    }
    expect((await hook<HookGuild>(pages[0]!, 'guild'))?.guild).toMatchObject({ level: 1, exp: 0, expToNext: 100 });
    expect((await hook<HookGuild>(pages[0]!, 'guild'))?.guild?.members.every((member) => member.online)).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

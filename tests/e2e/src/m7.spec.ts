import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { createDedicatedE2ePool, validateDedicatedE2eDatabaseUrl } from '../config/safety.js';

const PASSWORD = 'Ninja!Test123';
const START_MAP_NAME = 'Làng Khởi Nguồn';

test.describe.configure({ timeout: 240_000 });

interface HookM7 {
  readonly event: {
    readonly enabled: boolean;
    readonly utcDay: string;
    readonly loginClaimed: boolean;
    readonly quest: {
      readonly progress: number;
      readonly target: number;
      readonly complete: boolean;
      readonly rewarded: boolean;
    };
  };
  readonly boss: {
    readonly id: string;
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
interface HookBattle {
  readonly battleId: string;
  readonly roundNo: number;
  readonly actorId: string;
  readonly isMyTurn: boolean;
  readonly participants: readonly { readonly id: string; readonly name: string; readonly kind: string }[];
  readonly outcome: string | null;
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

function dedicatedE2eDatabaseUrl(): string {
  const connectionString = process.env.NINJA_E2E_DATABASE_URL;
  test.skip(!connectionString, 'Boss-victory fixture requires a disposable NINJA_E2E_DATABASE_URL.');
  if (!connectionString) throw new Error('NINJA_E2E_DATABASE_URL is required for the boss-victory fixture.');
  return validateDedicatedE2eDatabaseUrl(connectionString);
}

async function prepareBossTestCharacters(connectionString: string, names: readonly string[]): Promise<void> {
  const pool = createDedicatedE2ePool(connectionString, Pool);
  try {
    const result = await pool.query(
      'UPDATE characters SET level = 60, exp = 0, hp = NULL, mp = NULL, updated_at = now() WHERE name = ANY($1::varchar[])',
      [names],
    );
    if (result.rowCount !== names.length) {
      throw new Error(`Expected to prepare ${names.length} boss-test characters, found ${result.rowCount}.`);
    }
  } finally {
    await pool.end();
  }
}

async function attackBossThroughBrowser(page: Page, bossId: string): Promise<void> {
  await page.evaluate((id) => {
    const api = (globalThis as unknown as {
      __ninjaWorld?: { attackMonsterById(targetId: string): void };
    }).__ninjaWorld;
    api?.attackMonsterById(id);
  }, bossId);
}

async function defeatBossThroughBrowser(pages: readonly Page[]): Promise<HookBattle[]> {
  const acted = new Set<string>();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const battle = await hook<HookBattle>(page, 'battle');
      if (!battle || !battle.isMyTurn) continue;
      const actionKey = `${battle.battleId}:${battle.roundNo}:${battle.actorId}`;
      if (acted.has(actionKey)) continue;
      acted.add(actionKey);
      try {
        await page.getByRole('button', { name: 'Đánh thường' }).click({ timeout: 2_000 });
      } catch {
        acted.delete(actionKey);
      }
    }
    const battles = await Promise.all(pages.map((page) => hook<HookBattle>(page, 'battle')));
    if (battles.every((battle) => battle?.outcome !== null && battle?.outcome !== undefined)) {
      return battles as HookBattle[];
    }
    await pages[0]!.waitForTimeout(100);
  }
  throw new Error('Timed out before the three browser clients received a battle outcome.');
}

test('M7: three guild members chat together and first event login reward is claimable once', async ({ browser }) => {
  test.skip(!process.env.NINJA_E2E_DATABASE_URL, 'Requires the dedicated disposable ninja_m7_e2e database.');
  dedicatedE2eDatabaseUrl();
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

test('M7: three guild members defeat the field boss, receive capped loot and finish the event quest', async ({ browser }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.NINJA_E2E_DATABASE_URL, 'Requires the dedicated disposable ninja_m7_e2e database.');
  const databaseUrl = dedicatedE2eDatabaseUrl();
  const suffix = await uniqueSuffix();
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const names = await Promise.all([
      enterWorld(pages[0]!, 'M7A', suffix),
      enterWorld(pages[1]!, 'M7B', suffix),
      enterWorld(pages[2]!, 'M7C', suffix),
    ]);
    await prepareBossTestCharacters(databaseUrl, names);

    const guildName = `Vuong${suffix.slice(-5)}`;
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
      await page.locator('.guild-panel .close').click();
    }
    const bossState = await hook<HookM7>(pages[0]!, 'm7');
    expect(bossState?.boss).toMatchObject({ active: true, id: 'mob-thu-vuong', mapId: 'lang-khoi-nguon' });
    const boss = (await hook<{ id: string; name: string; alive: boolean }[]>(pages[0]!, 'monsters'))!
      .find((monster) => monster.id && monster.name === 'Thú Vương' && monster.alive);
    expect(boss).toBeDefined();
    const bossId = boss!.id;
    for (let index = 0; index < pages.length; index += 1) {
      await attackBossThroughBrowser(pages[index]!, bossId);
      await expect.poll(async () => (await hook<HookBattle>(pages[index]!, 'battle'))
        ?.participants.filter((participant) => participant.kind === 'player').length, { timeout: 25_000 })
        .toBe(index + 1);
    }

    const outcomes = await defeatBossThroughBrowser(pages);
    for (let index = 0; index < pages.length; index += 1) {
      const battle = outcomes[index]!;
      expect(battle.outcome).toBe('victory');
      expect(battle.participants.filter((participant) => participant.kind === 'player').map((player) => player.name).sort())
        .toEqual([...names].sort());
      await expect.poll(async () => (await hook<HookM7>(pages[index]!, 'm7'))?.boss.dailyLootClaimed).toBe(true);
      await expect.poll(async () => (await hook<HookM7>(pages[index]!, 'm7'))?.event.quest).toMatchObject({
        progress: 1,
        target: 1,
        complete: true,
        rewarded: true,
      });
      await expect.poll(async () => (await hook<HookGuild>(pages[index]!, 'guild'))?.guild?.exp).toBe(25);
      await expect.poll(async () => (await hook<{ itemId: string; quantity: number }[]>(pages[index]!, 'inventory'))
        ?.find((item) => item.itemId === 'item-da-vun')?.quantity).toBe(1);
      await expect.poll(async () => (await hook<{ subject: string }[]>(pages[index]!, 'mails'))
        ?.filter((mail) => mail.subject === 'Thưởng thử thách sự kiện').length).toBe(1);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

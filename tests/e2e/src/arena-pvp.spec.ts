import { expect, test, type Page } from '@playwright/test';

/**
 * Lôi Đài 1v1 (M6): hai người chơi thật vào hàng chờ, đánh nhau trong khung chiến đấu chung, điểm
 * Elo đổi đúng chiều và bảng xếp hạng hiện đúng thứ tự.
 *
 * Đường lên cấp trong bài này giống người chơi thật: hạ **một con chuột đồng** trong làng (140 kinh
 * nghiệm) là đủ vượt mốc cấp 3 (30 + 76) — mốc tối thiểu để vào Lôi Đài.
 */

const PASSWORD = 'matkhau123';
const START_MAP_NAME = 'Làng Khởi Nguồn';
const VILLAGE_MOUSE = 'Chuột Đồng';
const ARENA_MIN_LEVEL = 3;
const START_RATING = 1_000;
/** Hai bên ngang điểm: thắng +16, thua -16 (K = 32, kỳ vọng 0,5). */
const EQUAL_DELTA = 16;

test.describe.configure({ timeout: 480_000 });

interface HookCharacter {
  readonly level: number;
  readonly exp: number;
  readonly yen: number;
}

interface HookBattle {
  readonly isMyTurn: boolean;
  readonly outcome: string | null;
  readonly mode: string;
}

interface HookArena {
  readonly queued: boolean;
  readonly queueSize: number;
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
}

interface HookMonster {
  readonly name: string;
  readonly alive: boolean;
}

interface HookApi {
  readonly character: () => HookCharacter | null;
  readonly battle: () => HookBattle | null;
  readonly arena: () => HookArena;
  readonly monsters: () => readonly HookMonster[];
  readonly attackMonster: (name: string) => void;
}

async function hook<T>(page: Page, name: string): Promise<T | null> {
  return page.evaluate((hookName) => {
    const api = (globalThis as unknown as { __ninjaWorld?: Record<string, unknown> }).__ninjaWorld;
    const fn = api?.[hookName];
    return typeof fn === 'function' ? (fn as () => unknown)() : null;
  }, name) as Promise<T | null>;
}

async function arena(page: Page): Promise<HookArena> {
  const value = await hook<HookArena>(page, 'arena');
  if (!value) {
    throw new Error('client chưa có hook arena()');
  }
  return value;
}

async function battle(page: Page): Promise<HookBattle | null> {
  return hook<HookBattle>(page, 'battle');
}

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

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
  await expect.poll(async () => (await hook<HookArena>(page, 'arena')) !== null).toBe(true);
  return characterName;
}

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

/** Hạ một con quái trong làng rồi đóng bảng kết trận. */
async function killOneMonster(page: Page, name: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const monsters = (await hook<readonly HookMonster[]>(page, 'monsters')) ?? [];
        return monsters.some((monster) => monster.name === name && monster.alive);
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.evaluate((monsterName) => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    api?.attackMonster(monsterName);
  }, name);

  const attack = page.getByRole('button', { name: 'Đánh thường' });
  const deadline = Date.now() + 90_000;
  for (;;) {
    const current = await battle(page);
    if (!current) {
      if (Date.now() > deadline) {
        throw new Error(`trận với ${name} không mở ra`);
      }
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
  await expect.poll(async () => (await battle(page)) === null, { timeout: 10_000 }).toBe(true);
}

/** Đưa một nhân vật mới lên cấp tối thiểu để vào Lôi Đài bằng cách hạ một con chuột đồng. */
async function levelUpToArena(page: Page): Promise<void> {
  const before = await hook<HookCharacter>(page, 'character');
  expect(before?.level).toBe(1);
  await killOneMonster(page, VILLAGE_MOUSE);
  await expect
    .poll(async () => (await hook<HookCharacter>(page, 'character'))?.level, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(ARENA_MIN_LEVEL);
}

/** Đánh tới khi trận Lôi Đài kết thúc; trả về true nếu cả hai bên đã rời khung chiến đấu. */
async function fightArenaUntilEnd(pages: readonly Page[]): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const battles = await Promise.all(pages.map((page) => battle(page)));
    if (battles.every((current) => current === null || current.outcome !== null)) {
      return;
    }
    await Promise.all(
      pages.map(async (page, index) => {
        const current = battles[index];
        if (current && current.isMyTurn && !current.outcome) {
          await page
            .getByRole('button', { name: 'Đánh thường' })
            .click({ timeout: 2_000 })
            .catch(() => undefined);
        }
      }),
    );
    await pages[0]?.waitForTimeout(150);
  }
  throw new Error('trận Lôi Đài không kết thúc sau 180 giây');
}

test.describe('Lôi Đài 1v1', () => {
  test('chặn người chưa đủ cấp, hai người ghép trận, điểm đổi và bảng xếp hạng đúng thứ tự', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    try {
      const nameA = await enterWorld(pageA, 'A6');
      const nameB = await enterWorld(pageB, 'B6');

      // Chưa đủ cấp 3: nút vào hàng chờ bị server từ chối kèm câu nói rõ cần cấp mấy.
      await togglePanel(pageA, '.hud__arena', '.arena-panel', true);
      await expect(pageA.locator('.arena-rating')).toContainText(String(START_RATING));
      await pageA.locator('.arena-queue').click();
      await expect(pageA.locator('.notice-bar')).toContainText(
        new RegExp(`cấp ${ARENA_MIN_LEVEL}`),
      );
      expect((await arena(pageA)).queued).toBe(false);
      await togglePanel(pageA, '.hud__arena', '.arena-panel', false);

      await levelUpToArena(pageA);
      await levelUpToArena(pageB);

      // Vào rồi rời hàng chờ trước khi có đối thủ.
      await togglePanel(pageA, '.hud__arena', '.arena-panel', true);
      await pageA.locator('.arena-queue').click();
      await expect.poll(async () => (await arena(pageA)).queued, { timeout: 10_000 }).toBe(true);
      await pageA.locator('.arena-cancel').click();
      await expect.poll(async () => (await arena(pageA)).queued, { timeout: 10_000 }).toBe(false);

      // Hai người cùng vào hàng chờ → server ghép ngay thành một trận.
      await pageA.locator('.arena-queue').click();
      await expect.poll(async () => (await arena(pageA)).queued, { timeout: 10_000 }).toBe(true);
      await togglePanel(pageB, '.hud__arena', '.arena-panel', true);
      await pageB.locator('.arena-queue').click();
      await expect.poll(async () => (await battle(pageA))?.mode, { timeout: 30_000 }).toBe('arena');
      await expect.poll(async () => (await battle(pageB))?.mode, { timeout: 30_000 }).toBe('arena');

      // Cả hai đều ra khỏi hàng chờ, khung chiến đấu nói rõ đây là Lôi Đài và không có nút bỏ chạy.
      expect((await arena(pageA)).queued).toBe(false);
      expect((await arena(pageB)).queued).toBe(false);
      await expect(pageA.locator('.battle__mode')).toContainText('Lôi Đài');
      await expect(pageB.locator('.battle__mode')).toContainText('Lôi Đài');
      await expect(pageA.locator('.btn--flee')).toHaveCount(0);
      await expect(pageB.locator('.btn--flee')).toHaveCount(0);

      await fightArenaUntilEnd([pageA, pageB]);
      await expect.poll(async () => (await battle(pageA)) === null, { timeout: 15_000 }).toBe(true);
      await expect.poll(async () => (await battle(pageB)) === null, { timeout: 15_000 }).toBe(true);

      // Điểm: hai bên ngang 1000 nên người thắng lên 1016, người thua xuống 984 — và mỗi bên thấy
      // đúng dấu của mình trong bảng kết quả.
      const afterA = await arena(pageA);
      const afterB = await arena(pageB);
      const aWon = afterA.wins === 1;
      const winner = aWon ? nameA : nameB;
      const loser = aWon ? nameB : nameA;
      const winnerPage = aWon ? pageA : pageB;
      const loserPage = aWon ? pageB : pageA;

      expect(aWon ? afterB.wins : afterA.wins).toBe(0);
      expect(aWon ? afterA.losses : afterB.losses).toBe(0);
      expect(aWon ? afterB.losses : afterA.losses).toBe(1);
      expect(aWon ? afterA.rating : afterB.rating).toBe(START_RATING + EQUAL_DELTA);
      expect(aWon ? afterB.rating : afterA.rating).toBe(START_RATING - EQUAL_DELTA);

      await togglePanel(winnerPage, '.hud__arena', '.arena-panel', true);
      await togglePanel(loserPage, '.hud__arena', '.arena-panel', true);
      await expect(winnerPage.locator('.arena-result__delta')).toHaveText(`+${EQUAL_DELTA}`);
      await expect(loserPage.locator('.arena-result__delta')).toHaveText(`-${EQUAL_DELTA}`);
      await expect(winnerPage.locator('.arena-result')).toContainText('Thắng');
      await expect(loserPage.locator('.arena-result')).toContainText('Thua');
      await expect(winnerPage.locator('.arena-rating')).toContainText(
        String(START_RATING + EQUAL_DELTA),
      );

      // Bảng xếp hạng Lôi Đài: bảng là của cả server (những lần chạy trước còn trong DB), nên kiểm
      // đúng thứ tự tương đối giữa hai người này và đúng điểm của từng người, không kiểm vị trí tuyệt
      // đối.
      await winnerPage.locator('.arena-board-tab--arena').click();
      const arenaNames = () => winnerPage.locator('.arena-entry__name').allTextContents();
      await expect
        .poll(async () => {
          const names = await arenaNames();
          return names.includes(winner) && names.includes(loser);
        })
        .toBe(true);
      const arenaOrder = await arenaNames();
      expect(arenaOrder.indexOf(winner)).toBeLessThan(arenaOrder.indexOf(loser));
      expect(await winnerPage.locator('.arena-entry__rating').first().textContent()).toMatch(
        /^\d+$/,
      );
      const winnerRow = winnerPage.locator('.arena-entry').filter({ hasText: winner });
      const loserRow = winnerPage.locator('.arena-entry').filter({ hasText: loser });
      await expect(winnerRow.locator('.arena-entry__rating')).toHaveText(
        String(START_RATING + EQUAL_DELTA),
      );
      await expect(loserRow.locator('.arena-entry__rating')).toHaveText(
        String(START_RATING - EQUAL_DELTA),
      );

      // Bảng cấp độ cũng có hai nhân vật vừa lên cấp 3; bảng xếp theo cấp rồi kinh nghiệm nên chỉ
      // kiểm hai dòng này có mặt và đúng cấp của họ.
      await winnerPage.locator('.arena-board-tab--level').click();
      await expect
        .poll(async () =>
          (await winnerPage.locator('.arena-entry__name').allTextContents()).includes(winner),
        )
        .toBe(true);
      const winnerLevelRow = winnerPage.locator('.arena-entry').filter({ hasText: winner });
      const loserLevelRow = winnerPage.locator('.arena-entry').filter({ hasText: loser });
      await expect(winnerLevelRow.locator('.arena-entry__level')).toContainText('3');
      await expect(loserLevelRow.locator('.arena-entry__level')).toContainText('3');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

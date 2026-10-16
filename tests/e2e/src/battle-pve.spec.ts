import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Luồng M3: chiến đấu theo lượt PvE. Người chơi đi sang bãi luyện tập, bấm vào quái để vào trận,
 * đánh theo lượt cho tới khi hạ được quái, nhận kinh nghiệm/yên/vật phẩm rơi, lên cấp, dùng vật phẩm
 * vừa nhặt; hai người chơi cùng vào một trận; và lệnh không hợp lệ bị server từ chối.
 *
 * Mỗi test dùng tài khoản mới nên chạy lại nhiều lần vẫn đúng.
 */

const PASSWORD = 'matkhau123';

/** Tên bản đồ như trong game-data (client hiển thị đúng tên này ở HUD). */
const START_MAP_NAME = 'Làng Khởi Nguồn';
const TRAINING_MAP_NAME = 'Bãi Luyện Tập';
/** Quái đầu tiên trong bãi luyện tập (xem `game-data/maps/bai-luyen-tap.json`). */
const SCARECROW = 'Bù Nhìn Tập Luyện';
const SCARECROW_HP = 30;
/** Bù nhìn thưởng 90 kinh nghiệm; ba con là đủ lên cấp 4 (tổng 238 kinh nghiệm). */
const LEVEL_AFTER_THREE_KILLS = 4;

/** Hook kiểm thử mà trang `/play` phơi ra ở chế độ phát triển (xem `game/test-hook.ts`). */
interface HookApi {
  monsters(): HookMonster[];
  monsterNames(): string[];
  attackMonster(name: string): void;
  attackMonsterAt(index: number): void;
  battle(): HookBattle | null;
  closeBattle(): void;
  character(): HookCharacter | null;
  inventory(): { itemId: string; name: string; quantity: number; usable: boolean }[];
  useItem(name: string): void;
  toggleInventory(open?: boolean): void;
  inventoryOpen(): boolean;
  lastError(): string | null;
  localPlayerName(): string;
  position(name: string): { x: number; y: number } | null;
  entityNames(): string[];
}

/** Trạng thái trận đấu mà client đang vẽ (hook chỉ có ở chế độ phát triển). */
interface HookBattle {
  readonly battleId: string;
  readonly roundNo: number;
  readonly actorName: string;
  readonly isMyTurn: boolean;
  readonly participants: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly alive: boolean;
  }[];
  readonly logLines: readonly string[];
  readonly outcome: string | null;
  readonly rewards: {
    readonly exp: number;
    readonly yen: number;
    readonly levelsGained: number;
    readonly drops: readonly { readonly name: string; readonly qty: number }[];
  } | null;
}

interface HookCharacter {
  readonly level: number;
  readonly exp: number;
  readonly expToNext: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly yen: number;
}

interface HookMonster {
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly shape: string;
  readonly alive: boolean;
}

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function enterWorld(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const username = `b3${suffix}`;
  const characterName = `B3${suffix.slice(-5)}`;

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
  return characterName;
}

/** Giữ một phím cho tới khi HUD hiện tên bản đồ cần tới, rồi nhả phím. */
async function walkUntilMap(page: Page, key: string, mapName: string): Promise<void> {
  await page.keyboard.down(key);
  try {
    await expect(page.locator('.hud .map-name')).toHaveText(mapName, { timeout: 25_000 });
  } finally {
    await page.keyboard.up(key);
  }
}

/** Vào bãi luyện tập (nơi có quái) bằng cách đi bộ qua cổng ở phía đông làng. */
async function enterTrainingGround(page: Page): Promise<void> {
  await walkUntilMap(page, 'ArrowRight', TRAINING_MAP_NAME);
}

async function monsters(page: Page): Promise<HookMonster[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.monsters() : [];
  });
}

async function battle(page: Page): Promise<HookBattle | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.battle() : null;
  });
}

async function character(page: Page): Promise<HookCharacter | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.character() : null;
  });
}

/**
 * Bấm vào một con quái còn sống: đủ gần thì vào trận ngay, ở xa thì client tự đi tới rồi vào trận.
 * Phải chờ có con nào còn sống trước đã: bài trước có thể vừa giết hết cả bãi (4 con bù nhìn) và
 * quái chưa kịp hồi sinh, bấm lúc đó thì không có trận nào mở ra.
 */
async function attackMonster(page: Page, name: string): Promise<void> {
  await expect
    .poll(
      async () => (await monsters(page)).some((monster) => monster.name === name && monster.alive),
      {
        message: `chờ ${name} hồi sinh trước khi bấm`,
        timeout: 30_000,
      },
    )
    .toBe(true);
  await page.evaluate((target) => {
    (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld?.attackMonster(target);
  }, name);
}

/** Bấm vào con quái thứ `index` trong danh sách đang vẽ (kể cả con đã gục). */
async function attackMonsterAt(page: Page, index: number): Promise<void> {
  await page.evaluate((target) => {
    (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld?.attackMonsterAt(target);
  }, index);
}

async function lastError(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.lastError() : null;
  });
}

/** Vị trí nhân vật của mình theo góc nhìn client. */
async function localPosition(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    if (!api) {
      return null;
    }
    return api.position(api.localPlayerName());
  });
}

/** Chờ trận mở ra (server nhận lệnh chạm quái và trả `S2C_BATTLE_START`). */
async function waitForBattle(page: Page): Promise<void> {
  await expect
    .poll(async () => (await battle(page)) !== null, {
      message: 'chờ trận đấu mở ra',
      timeout: 20_000,
    })
    .toBe(true);
}

/**
 * Đánh cho tới khi trận kết thúc: mỗi lần tới lượt thì bấm nút "Đánh thường" **trong giao diện**
 * (đúng đường người chơi đi, không gọi thẳng hàm nội bộ).
 */
async function fightToTheEnd(page: Page): Promise<HookBattle> {
  const attackButton = page.getByRole('button', { name: 'Đánh thường' });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const current = await battle(page);
    if (current?.outcome) {
      return current;
    }
    if (current?.isMyTurn) {
      // Hạn ngắn cho cú bấm: trận vừa kết thúc thì nút biến mất và bảng kết trận thay chỗ, bấm
      // không giới hạn sẽ treo tới hết bài; bấm hụt thì vòng lặp quay lại và thấy `outcome`.
      await attackButton.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(120);
  }
  throw new Error('trận đấu không kết thúc sau 60 giây');
}

/** Đánh hạ một con quái rồi đóng bảng kết trận. */
async function killOneMonster(page: Page): Promise<HookBattle> {
  await attackMonster(page, SCARECROW);
  await waitForBattle(page);
  const finished = await fightToTheEnd(page);
  await page.getByRole('button', { name: 'Đóng' }).click();
  await expect.poll(async () => (await battle(page)) === null, { timeout: 10_000 }).toBe(true);
  return finished;
}

test('đánh hạ quái: có lượt, có nhật ký, nhận thưởng và vật phẩm rơi', async ({ page }) => {
  await enterWorld(page);
  await enterTrainingGround(page);

  // Bãi luyện tập có bốn con bù nhìn, đầy máu và đúng hình dáng trong dữ liệu.
  const before = await monsters(page);
  expect(before).toHaveLength(4);
  expect(before[0]).toMatchObject({
    name: SCARECROW,
    hp: SCARECROW_HP,
    maxHp: SCARECROW_HP,
    shape: 'scarecrow',
    alive: true,
  });

  await attackMonster(page, SCARECROW);
  await waitForBattle(page);

  // Người chơi cấp 1 nhanh hơn bù nhìn nên được đi trước, và bảng trận đấu hiện đủ thứ cần thiết.
  const opening = await battle(page);
  expect(opening?.isMyTurn).toBe(true);
  expect(opening?.participants.filter((entry) => entry.kind === 'monster')).toHaveLength(1);
  await expect(page.locator('.battle')).toContainText(SCARECROW);
  await expect(page.locator('.battle')).toContainText('Tới lượt bạn');
  await expect(page.getByRole('button', { name: 'Bỏ chạy' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Trảm Cơ Bản/ })).toBeVisible();

  const finished = await fightToTheEnd(page);

  expect(finished.outcome).toBe('victory');
  expect(finished.rewards?.exp).toBeGreaterThan(0);
  expect(finished.rewards?.yen).toBeGreaterThan(0);
  expect(finished.rewards?.drops.map((drop) => drop.name)).toContain('Bánh Bao Hấp');
  // Nhật ký có cả đòn của mình lẫn đòn của quái: lượt là của cả hai bên.
  expect(finished.logLines.some((line) => line.includes('Bù Nhìn Tập Luyện đánh'))).toBe(true);
  expect(finished.logLines.at(-1)).toContain('đã bị hạ gục');

  // Bảng kết trận hiện phần thưởng, và quái trên bản đồ nằm lại với 0 máu.
  await expect(page.locator('.result')).toContainText('Thắng trận');
  await expect(page.locator('.result')).toContainText('Kinh nghiệm');
  await expect(page.locator('.result')).toContainText('Bánh Bao Hấp');

  await page.getByRole('button', { name: 'Đóng' }).click();
  await expect.poll(async () => (await battle(page)) === null, { timeout: 10_000 }).toBe(true);
  await expect
    .poll(async () => (await monsters(page)).filter((monster) => !monster.alive).length, {
      message: 'chờ con bù nhìn đầu tiên gục trên bản đồ',
      timeout: 10_000,
    })
    .toBe(1);
});

test('đánh liên tiếp ba con quái thì lên ba cấp, và dùng được vật phẩm nhặt được', async ({
  page,
}) => {
  await enterWorld(page);
  await enterTrainingGround(page);

  for (let kill = 0; kill < 3; kill += 1) {
    const finished = await killOneMonster(page);
    expect(finished.outcome).toBe('victory');
  }

  const stats = await character(page);
  expect(stats?.level).toBe(LEVEL_AFTER_THREE_KILLS);

  // Thông báo lên cấp hiện ra ở thanh thông báo, không cần mở bảng nào.
  await expect(page.locator('.notice-bar')).toContainText('Lên cấp 4');

  // Vật phẩm rơi đã vào túi và dùng được để hồi máu (bù nhìn có đánh trúng trong ba trận).
  await expect.poll(async () => (await stats?.hp) ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  const wounded = stats!.hp;
  expect(wounded).toBeLessThan(stats!.maxHp);

  await page.getByRole('button', { name: /Túi đồ/ }).click();
  await expect(page.locator('.bag')).toContainText('Bánh Bao Hấp');
  await page.locator('.bag__use').first().click();

  await expect
    .poll(async () => (await character(page))?.hp ?? 0, {
      message: 'chờ máu hồi sau khi dùng bánh bao',
      timeout: 10_000,
    })
    .toBeGreaterThan(wounded);
});

test('hai người chơi cùng đánh chung một con quái', async ({ browser }) => {
  const contextA: BrowserContext = await browser.newContext();
  const contextB: BrowserContext = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await enterWorld(pageA);
    await enterWorld(pageB);
    await enterTrainingGround(pageA);
    await enterTrainingGround(pageB);

    await attackMonster(pageA, SCARECROW);
    await waitForBattle(pageA);
    const firstBattle = await battle(pageA);
    expect(firstBattle?.participants).toHaveLength(2);

    // Người thứ hai cũng chạm đúng con quái đó: vào **chung** trận, không mở trận mới.
    await attackMonster(pageB, SCARECROW);
    await waitForBattle(pageB);
    const secondBattle = await battle(pageB);
    expect(secondBattle?.battleId).toBe(firstBattle?.battleId);
    expect(secondBattle?.participants.filter((entry) => entry.kind === 'player')).toHaveLength(2);

    // Cả hai cùng đánh cho tới khi hạ được con quái, và cả hai đều nhận thưởng.
    const [endA, endB] = await Promise.all([fightToTheEnd(pageA), fightToTheEnd(pageB)]);
    expect(endA.outcome).toBe('victory');
    expect(endB.outcome).toBe('victory');
    expect(endA.rewards?.exp).toBe(endB.rewards?.exp);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('lệnh không hợp lệ bị server từ chối và hiện lý do cho người chơi', async ({ page }) => {
  await enterWorld(page);
  await enterTrainingGround(page);

  // Đánh con bù nhìn đầu tiên cho tới khi nó gục.
  await killOneMonster(page);

  // Chạm lại **đúng con vừa gục** (bấm theo vị trí, như người chơi bấm vào xác con quái):
  // server trả `monster_gone`, client hiện lý do thật trong thanh thông báo.
  await attackMonsterAt(page, 0);
  await expect
    .poll(async () => (await lastError(page)) ?? '', {
      message: 'chờ server từ chối lệnh đánh con quái đã gục',
      timeout: 10_000,
    })
    .toContain('sống lại');
  expect(await battle(page)).toBeNull();

  // Trong trận thì không đi được: bấm giữ phím di chuyển cũng không nhân vật nào nhúc nhích.
  await attackMonster(page, SCARECROW);
  await waitForBattle(page);
  const positionBefore = await localPosition(page);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowRight');
  const positionAfter = await localPosition(page);
  expect(positionAfter).toEqual(positionBefore);
});

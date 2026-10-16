import { expect, test, type Page } from '@playwright/test';

/**
 * Luồng M4: trang bị theo ô, shop mua/bán bằng yên và cường hóa.
 *
 * Ba việc chính của cột mốc, kiểm đúng như roadmap viết: mua trang bị ở shop, mặc vào thấy chỉ số
 * tăng, cường hóa đúng tỉ lệ trong dữ liệu, và tải lại trang thì trạng thái vẫn giữ nguyên. Mỗi test
 * dùng tài khoản mới nên chạy lại nhiều lần vẫn đúng.
 */

const PASSWORD = 'matkhau123';
const START_MAP_NAME = 'Làng Khởi Nguồn';

/** NPC bán hàng ở làng và các món dùng trong bài (xem `game-data/npcs/npc-thay-do.json`). */
const SHOP_NPC = 'Thầy Đồ';
const ARMOR = 'Áo Vải';
const SWORD = 'Kiếm Gỗ';
const BREAD = 'Bánh Bao Hấp';
const IRON_SWORD = 'Kiếm Sắt';

/** Nhân vật haruna/dao cấp 1 có 60 máu; Áo Vải cộng 20 máu nên thành 80. */
const BASE_MAX_HP = 60;
const ARMOR_MAX_HP = 80;
/** Áo Vải giá 150 yên; yên ban đầu của nhân vật mới là 200. */
const ARMOR_PRICE = 150;
const START_YEN = 200;
/** Bánh bao giá 30 yên, shop mua lại 40% = 12 yên (`SELL_PRICE_RATIO`). */
const BREAD_SELL_PRICE = 12;
/** Cường hóa từ cấp 0 lên 1 tốn 50 yên và tỉ lệ là 1.0 nên luôn thành công. */
const UPGRADE_FIRST_COST = 50;
/**
 * Mỗi lần thử cường hóa còn tốn 1 đá vụn (`UPGRADE_MATERIAL_ID` trong shared), thứ chỉ rơi từ quái:
 * Chuột Đồng trong làng rơi 70% mỗi trận nên chỉ cần vài trận là có.
 */
const MATERIAL = 'Đá Vụn';
const VILLAGE_MONSTER = 'Chuột Đồng';
const MAX_FARM_KILLS = 5;

/** Hook kiểm thử mà trang `/play` phơi ra ở chế độ phát triển (xem `game/test-hook.ts`). */
interface HookApi {
  clickEntity(name: string): void;
  character(): HookCharacter | null;
  inventory(): HookItem[];
  equipment(): HookEquipmentSlot[];
  shop(): HookShop | null;
  monsters(): HookMonster[];
  battle(): HookBattle | null;
  attackMonster(name: string): void;
  toggleInventory(open?: boolean): void;
  toggleEquipment(open?: boolean): void;
  lastError(): string | null;
}

interface HookCharacter {
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly yen: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

interface HookItem {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly slot: string | null;
  readonly upgradeLevel: number;
  readonly sellPrice: number;
}

interface HookEquipmentSlot {
  readonly slot: string;
  readonly empty: boolean;
  readonly name: string;
  readonly upgradeLevel: number;
}

interface HookShop {
  readonly npcName: string;
  readonly entries: readonly {
    readonly name: string;
    readonly price: number;
    readonly sellPrice: number;
  }[];
}

interface HookMonster {
  readonly name: string;
  readonly hp: number;
  readonly alive: boolean;
}

interface HookBattle {
  readonly isMyTurn: boolean;
  readonly outcome: string | null;
  readonly rewards: {
    readonly exp: number;
    readonly yen: number;
    readonly drops: readonly { readonly name: string; readonly qty: number }[];
  } | null;
}

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

/** Đăng ký tài khoản mới, tạo nhân vật và vào thế giới; trả về tên nhân vật. */
async function enterWorld(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const username = `b4${suffix}`;
  const characterName = `B4${suffix.slice(-5)}`;

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

async function character(page: Page): Promise<HookCharacter | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.character() : null;
  });
}

async function inventory(page: Page): Promise<HookItem[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.inventory() : [];
  });
}

async function equipment(page: Page): Promise<HookEquipmentSlot[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.equipment() : [];
  });
}

async function lastError(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.lastError() : null;
  });
}

/** Mở quầy hàng: bấm vào NPC bán hàng trên canvas rồi chờ bảng shop hiện ra. */
async function openShop(page: Page): Promise<void> {
  await page.evaluate((name) => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    api?.clickEntity(name);
  }, SHOP_NPC);
  await expect(page.locator('.shop')).toBeVisible();
}

/**
 * Mở túi đồ bằng đúng nút trên HUD (không gọi thẳng hook) để kiểm luôn đường người chơi đi.
 * Gọi lại khi túi đang mở thì không làm gì — nút trên HUD là nút bật/tắt.
 */
async function openBag(page: Page): Promise<void> {
  if (await page.locator('.bag').isVisible()) {
    return;
  }
  await page.locator('.hud button', { hasText: 'Túi đồ' }).click();
  await expect(page.locator('.bag')).toBeVisible();
}

/** Mở bảng trang bị bằng nút trên HUD. */
async function openGear(page: Page): Promise<void> {
  await page.locator('.hud__gear').click();
  await expect(page.locator('.gear')).toBeVisible();
}

/** Dòng món trong bảng mua của shop (mỗi dòng có nút Mua, khác dòng ở bảng bán). */
function buyRow(page: Page, name: string) {
  return page.locator('.shop__row:has(.shop__buy)', { hasText: name });
}

/** Dòng món trong bảng bán của shop. */
function sellRow(page: Page, name: string) {
  return page.locator('.shop__row:has(.shop__sell)', { hasText: name });
}

function bagRow(page: Page, name: string) {
  return page.locator('.bag__row', { hasText: name });
}

/** Quái đang vẽ trên bản đồ (hook chỉ có ở chế độ phát triển). */
async function monsters(page: Page): Promise<HookMonster[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.monsters() : [];
  });
}

/** Trạng thái trận đấu mà client đang vẽ. */
async function battle(page: Page): Promise<HookBattle | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.battle() : null;
  });
}

/** Bấm vào một con quái còn sống: đủ gần thì vào trận ngay, ở xa thì client tự đi tới rồi vào trận. */
async function attackMonster(page: Page, name: string): Promise<void> {
  await page.evaluate((target) => {
    (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld?.attackMonster(target);
  }, name);
}

/** Chờ có một con quái cùng tên còn sống (con vừa gục hồi sinh sau ít giây). */
async function waitForAliveMonster(page: Page, name: string): Promise<void> {
  await expect
    .poll(
      async () => (await monsters(page)).some((monster) => monster.name === name && monster.alive),
      {
        message: `chờ ${name} hồi sinh`,
        timeout: 30_000,
      },
    )
    .toBe(true);
}

/** Chờ trận mở ra (server nhận lệnh chạm quái và trả `S2C_BATTLE_START`). */
async function waitForBattle(page: Page): Promise<void> {
  await expect
    .poll(async () => (await battle(page)) !== null, {
      message: 'chờ trận đấu mở ra',
      timeout: 25_000,
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
async function killOneMonster(page: Page, name: string): Promise<HookBattle> {
  await attackMonster(page, name);
  await waitForBattle(page);
  const finished = await fightToTheEnd(page);
  // Chỉ bấm nút trong bảng kết trận: túi đồ cũng có nút đóng (aria-label "Đóng túi đồ") nên tìm
  // theo tên chung sẽ khớp hai nút khi túi đang mở.
  await page.locator('.result').getByRole('button', { name: 'Đóng' }).click();
  await expect.poll(async () => (await battle(page)) === null, { timeout: 10_000 }).toBe(true);
  return finished;
}

/** Ăn một bánh bao trong túi để hồi máu trước trận sau (đánh nhau không tự hồi máu). */
async function healWithBread(page: Page): Promise<void> {
  const before = (await character(page))?.hp ?? 0;
  await openBag(page);
  const bread = bagRow(page, BREAD);
  if ((await bread.count()) === 0) {
    return;
  }
  await bread.locator('.bag__use').click();
  await expect
    .poll(async () => (await character(page))?.hp ?? 0, {
      message: 'chờ máu hồi sau khi ăn bánh bao',
      timeout: 10_000,
    })
    .toBeGreaterThan(before);
}

/**
 * Đi đánh quái cho tới khi nhặt được `itemName`: mỗi trận rơi theo tỉ lệ trong `game-data`, nên
 * vòng lặp chỉ dừng khi đã có đồ — hết `maxKills` trận mà vẫn không rơi thì coi như hỏng.
 */
async function farmDrop(
  page: Page,
  monsterName: string,
  itemName: string,
  maxKills: number,
): Promise<void> {
  for (let kill = 1; kill <= maxKills; kill += 1) {
    await waitForAliveMonster(page, monsterName);
    if (kill > 1) {
      await healWithBread(page);
    }
    const finished = await killOneMonster(page, monsterName);
    expect(finished.outcome, `trận ${kill} phải thắng`).toBe('victory');
    const held = (await inventory(page)).find((item) => item.name === itemName)?.quantity ?? 0;
    if (held >= 1) {
      return;
    }
  }
  throw new Error(`không nhặt được ${itemName} sau ${maxKills} trận`);
}

test('mua áo vải ở shop, mặc vào thấy chỉ số tăng, tải lại trang vẫn giữ', async ({ page }) => {
  await enterWorld(page);
  expect((await character(page))?.maxHp).toBe(BASE_MAX_HP);
  expect((await character(page))?.yen).toBe(START_YEN);

  // Quầy hàng của Thầy Đồ: bấm vào NPC trên canvas.
  await openShop(page);
  await expect(buyRow(page, ARMOR)).toBeVisible();
  await expect(buyRow(page, ARMOR)).toContainText(String(ARMOR_PRICE));
  await buyRow(page, ARMOR).locator('.shop__buy').click();
  await expect.poll(async () => (await character(page))?.yen).toBe(START_YEN - ARMOR_PRICE);
  await expect(page.locator('.shop')).toBeVisible();

  // Mặc áo: món rời túi, vào ô thân, máu tối đa tăng.
  await openBag(page);
  await expect(bagRow(page, ARMOR)).toBeVisible();
  await bagRow(page, ARMOR).locator('.bag__equip').click();
  await expect.poll(async () => (await character(page))?.maxHp).toBe(ARMOR_MAX_HP);

  await openGear(page);
  await expect(page.locator('.gear__row[data-slot="body"]')).toContainText(ARMOR);
  expect((await inventory(page)).some((item) => item.name === ARMOR)).toBe(false);
  expect((await equipment(page)).find((slot) => slot.slot === 'body')?.name).toBe(ARMOR);

  // Tháo ra thì chỉ số về như cũ và món quay lại túi.
  await page.locator('.gear__row[data-slot="body"] .gear__unequip').click();
  await expect.poll(async () => (await character(page))?.maxHp).toBe(BASE_MAX_HP);
  expect((await inventory(page)).some((item) => item.name === ARMOR)).toBe(true);

  // Mặc lại rồi tải lại trang: trang bị và chỉ số phải vào lại cùng nhân vật.
  await bagRow(page, ARMOR).locator('.bag__equip').click();
  await expect.poll(async () => (await character(page))?.maxHp).toBe(ARMOR_MAX_HP);

  await page.reload();
  await expect(page.locator('.hud .map-name')).toHaveText(START_MAP_NAME);
  await expect.poll(async () => (await character(page))?.maxHp).toBe(ARMOR_MAX_HP);
  await expect
    .poll(async () => (await equipment(page)).find((slot) => slot.slot === 'body')?.name)
    .toBe(ARMOR);
  expect((await character(page))?.yen).toBe(START_YEN - ARMOR_PRICE);
  expect((await inventory(page)).some((item) => item.name === ARMOR)).toBe(false);
});

test('bán bánh bao, đánh quái lấy đá vụn rồi cường hóa kiếm gỗ +1', async ({ page }) => {
  test.setTimeout(240_000);
  await enterWorld(page);
  await openShop(page);

  // Bán một bánh bao trong túi: nhận 40% giá gốc.
  const yenBeforeSell = (await character(page))?.yen ?? 0;
  const breadBefore = (await inventory(page)).find((item) => item.name === BREAD)?.quantity ?? 0;
  await sellRow(page, BREAD).locator('.shop__sell').click();
  await expect
    .poll(async () => (await character(page))?.yen)
    .toBe(yenBeforeSell + BREAD_SELL_PRICE);
  expect((await inventory(page)).find((item) => item.name === BREAD)?.quantity).toBe(
    breadBefore - 1,
  );

  // Mua kiếm gỗ (100 yên) rồi đóng quầy để đi đánh quái.
  await buyRow(page, SWORD).locator('.shop__buy').click();
  await expect
    .poll(async () => (await inventory(page)).some((item) => item.name === SWORD))
    .toBe(true);
  await page.locator('.shop__close').click();
  await expect(page.locator('.shop')).toBeHidden();

  // Cường hóa tốn 1 đá vụn — thứ chỉ rơi từ quái — nên phải vào một trận trước.
  await farmDrop(page, VILLAGE_MONSTER, MATERIAL, MAX_FARM_KILLS);

  // Cấp 0 → 1 luôn thành công, tốn 50 yên và 1 đá vụn.
  const yenBeforeUpgrade = (await character(page))?.yen ?? 0;
  const materialBefore =
    (await inventory(page)).find((item) => item.name === MATERIAL)?.quantity ?? 0;
  await openBag(page);
  await bagRow(page, SWORD).locator('.bag__upgrade').click();
  await expect
    .poll(async () => (await inventory(page)).find((item) => item.name === SWORD)?.upgradeLevel)
    .toBe(1);
  await expect(page.locator('.notice-bar')).toBeVisible();
  await expect(page.locator('.notice-bar')).toContainText(SWORD);
  expect((await character(page))?.yen).toBe(yenBeforeUpgrade - UPGRADE_FIRST_COST);
  // Tiêu hết đá vụn thì hàng đó biến khỏi túi (server xoá hàng khi số lượng về 0) nên `?? 0`.
  const materialAfter =
    (await inventory(page)).find((item) => item.name === MATERIAL)?.quantity ?? 0;
  expect(materialAfter).toBe(materialBefore - 1);

  // Mặc kiếm đã cường hóa: bảng trang bị hiện cấp, chỉ số tấn công tăng theo món.
  const attackBefore = (await character(page))?.attack ?? 0;
  await bagRow(page, SWORD).locator('.bag__equip').click();
  await expect
    .poll(async () => (await equipment(page)).find((slot) => slot.slot === 'weapon')?.name)
    .toBe(SWORD);
  expect((await equipment(page)).find((slot) => slot.slot === 'weapon')?.upgradeLevel).toBe(1);
  await expect.poll(async () => (await character(page))?.attack).toBeGreaterThan(attackBefore);
  await openGear(page);
  await expect(page.locator('.gear__row[data-slot="weapon"]')).toContainText('+1');
});

test('mua món đắt hơn số yên đang có thì bị từ chối và hiện thông báo', async ({ page }) => {
  await enterWorld(page);
  await openShop(page);

  await buyRow(page, IRON_SWORD).locator('.shop__buy').click();
  await expect.poll(async () => lastError(page)).not.toBeNull();
  await expect(page.locator('.notice-bar')).toBeVisible();

  expect((await character(page))?.yen).toBe(START_YEN);
  expect((await inventory(page)).some((item) => item.name === IRON_SWORD)).toBe(false);
});

test('mua lại món trang bị đã có thì bị từ chối', async ({ page }) => {
  await enterWorld(page);
  await openShop(page);

  await buyRow(page, ARMOR).locator('.shop__buy').click();
  await expect.poll(async () => (await character(page))?.yen).toBe(START_YEN - ARMOR_PRICE);

  await buyRow(page, ARMOR).locator('.shop__buy').click();
  await expect.poll(async () => lastError(page)).not.toBeNull();
  expect((await character(page))?.yen).toBe(START_YEN - ARMOR_PRICE);
  expect((await inventory(page)).filter((item) => item.name === ARMOR).length).toBeLessThanOrEqual(
    1,
  );
});

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Luồng M2: cổng dịch chuyển trong bản đồ. Người chơi **đi bộ** vào vùng cổng thì server tự đổi
 * bản đồ (client không xin phép), người ở lại thấy nhân vật biến mất, và đi ngược lại thì về làng.
 */

const PASSWORD = 'matkhau123';

/** Tên bản đồ như trong game-data (client hiển thị đúng tên này ở HUD). */
const START_MAP_NAME = 'Làng Khởi Nguồn';
const TRAINING_MAP_NAME = 'Bãi Luyện Tập';
/** Hàng của điểm spawn mà cổng dẫn tới ở bãi luyện tập (ô 6,14 → y = 14×32 + 16). */
const TRAINING_SPAWN_Y = 464;
/** Hàng của điểm spawn mặc định ở làng (ô 20,16 → y = 16×32 + 16). */
const START_SPAWN_Y = 528;
/**
 * Sai số cho phép theo hàng khi kiểm điểm spawn (px). Sau khi đổi bản đồ, phím còn đang giữ nên
 * nhân vật đi tiếp vài bước và toạ độ lệch chút ít; điều cần khẳng định là **dùng đúng điểm spawn
 * trong game-data** (hàng của nó), không phải chỗ nhân vật vừa rời đi. Nửa ô (16 px) là đủ chặt.
 */
const SPAWN_ROW_TOLERANCE_PX = 16;

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function enterWorld(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const username = `p2${suffix}`;
  const characterName = `P2${suffix.slice(-5)}`;

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

async function entityNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: { entityNames(): string[] } })
      .__ninjaWorld;
    return api ? api.entityNames() : [];
  });
}

async function position(page: Page, name: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((target) => {
    const api = (
      globalThis as unknown as {
        __ninjaWorld?: { position(name: string): { x: number; y: number } | null };
      }
    ).__ninjaWorld;
    return api ? api.position(target) : null;
  }, name);
}

/**
 * Giữ một phím và đi cho tới khi HUD hiện tên bản đồ `mapName`, rồi nhả phím. Cách này không phụ
 * thuộc thời gian đi chính xác: nhân vật đi nhanh hay chậm đều dừng ở đúng lúc đã sang bản đồ mới.
 */
async function walkUntilMap(page: Page, key: string, mapName: string): Promise<void> {
  await page.keyboard.down(key);
  try {
    await expect(page.locator('.hud .map-name')).toHaveText(mapName, { timeout: 20_000 });
  } finally {
    await page.keyboard.up(key);
  }
}

test('đi bộ vào vùng cổng thì sang bản đồ bên kia, đi ngược lại thì về làng', async ({
  browser,
}) => {
  const contextA: BrowserContext = await browser.newContext();
  const contextB: BrowserContext = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const nameA = await enterWorld(pageA);
    await enterWorld(pageB);
    await expect
      .poll(async () => (await entityNames(pageB)).includes(nameA), { timeout: 15_000 })
      .toBe(true);

    // A đi sang phía đông của làng cho tới khi vào vùng cổng (cổng ở ô x 35..37).
    await walkUntilMap(pageA, 'ArrowRight', TRAINING_MAP_NAME);

    // Điểm đến do cổng trong game-data quyết định (điểm spawn ở hàng 14), không phải chỗ A đang đi.
    // Sai số cho phép một phần ô: sau khi đổi bản đồ, phím vẫn đang giữ nên nhân vật đi tiếp vài
    // bước ngay lập tức, nhưng hàng thì phải đúng hàng của điểm spawn trong dữ liệu.
    const afterCrossing = await position(pageA, nameA);
    expect(afterCrossing).not.toBeNull();
    expect(Math.abs(afterCrossing!.y - TRAINING_SPAWN_Y)).toBeLessThan(SPAWN_ROW_TOLERANCE_PX);

    // Người ở lại không còn thấy A trên bản đồ của mình.
    await expect
      .poll(async () => (await entityNames(pageB)).includes(nameA), {
        message: `chờ "${nameA}" rời khỏi bản đồ của người ở lại`,
        timeout: 15_000,
      })
      .toBe(false);

    // Đi ngược lại về phía tây của bãi luyện tập để quay về làng.
    await walkUntilMap(pageA, 'ArrowLeft', START_MAP_NAME);

    const afterReturn = await position(pageA, nameA);
    expect(afterReturn).not.toBeNull();
    expect(Math.abs(afterReturn!.y - START_SPAWN_Y)).toBeLessThan(SPAWN_ROW_TOLERANCE_PX);

    // Người ở lại thấy A quay về.
    await expect
      .poll(async () => (await entityNames(pageB)).includes(nameA), { timeout: 15_000 })
      .toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

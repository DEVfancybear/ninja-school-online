import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Luồng M2: hai người chơi vào cùng bản đồ, thấy nhau di chuyển và chat qua lại;
 * đóng tab thì nhân vật biến mất khỏi màn hình người kia.
 *
 * Mỗi test dùng tài khoản mới nên chạy lại nhiều lần vẫn đúng.
 */

const PASSWORD = 'matkhau123';

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

/** Đăng ký tài khoản, tạo một nhân vật rồi vào thế giới; trả về tên nhân vật. */
async function enterWorld(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const username = `m2${suffix}`;
  const characterName = `M2${suffix.slice(-5)}`;

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
  return characterName;
}

/** Số thực thể đang vẽ trên canvas (đọc từ trạng thái thế giới mà trang phơi ra để kiểm thử). */
async function entityNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: { entityNames(): string[] } })
      .__ninjaWorld;
    return api ? api.entityNames() : [];
  });
}

async function waitForEntity(page: Page, name: string): Promise<void> {
  await expect
    .poll(async () => (await entityNames(page)).includes(name), {
      message: `chờ thấy nhân vật "${name}" trên bản đồ`,
      timeout: 15_000,
    })
    .toBe(true);
}

/** Vị trí của một thực thể theo góc nhìn của client đang mở trang. */
async function entityPosition(page: Page, name: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((target) => {
    const api = (
      globalThis as unknown as {
        __ninjaWorld?: { position(name: string): { x: number; y: number } | null };
      }
    ).__ninjaWorld;
    return api ? api.position(target) : null;
  }, name);
}

test('hai người chơi cùng bản đồ thấy nhau và thấy nhau di chuyển', async ({ browser }) => {
  const contextA: BrowserContext = await browser.newContext();
  const contextB: BrowserContext = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const nameA = await enterWorld(pageA);
    await waitForEntity(pageA, nameA);

    const nameB = await enterWorld(pageB);
    await waitForEntity(pageB, nameB);

    // Mỗi bên phải thấy nhân vật của bên kia trên bản đồ.
    await waitForEntity(pageA, nameB);
    await waitForEntity(pageB, nameA);

    // A đi sang phải (ô bên phải điểm spawn trong Làng Khởi Nguồn đều đi được);
    // B phải thấy vị trí của A thay đổi.
    const beforeOnB = await entityPosition(pageB, nameA);
    expect(beforeOnB).not.toBeNull();

    await pageA.keyboard.down('ArrowRight');
    await pageA.waitForTimeout(1200);
    await pageA.keyboard.up('ArrowRight');
    await pageA.waitForTimeout(600);

    const afterOnB = await entityPosition(pageB, nameA);
    expect(afterOnB).not.toBeNull();
    expect(afterOnB!.x).toBeGreaterThan(beforeOnB!.x + 20);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('chat trong cùng bản đồ: người kia nhận được tin nhắn', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const nameA = await enterWorld(pageA);
    const nameB = await enterWorld(pageB);
    await waitForEntity(pageA, nameB);

    const message = `xin chào ${uniqueSuffix()}`;
    await pageA.getByPlaceholder(/nhập tin nhắn/i).fill(message);
    await pageA.getByPlaceholder(/nhập tin nhắn/i).press('Enter');

    await expect(pageB.locator('.chat-log')).toContainText(message);
    await expect(pageB.locator('.chat-log')).toContainText(nameA.trim());
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('đóng tab thì nhân vật biến mất khỏi bản đồ người khác', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await enterWorld(pageA);
    const nameB = await enterWorld(pageB);
    await waitForEntity(pageA, nameB);

    await contextB.close();

    await expect
      .poll(async () => (await entityNames(pageA)).includes(nameB), {
        message: `chờ nhân vật "${nameB}" biến mất khỏi bản đồ`,
        timeout: 20_000,
      })
      .toBe(false);
  } finally {
    await contextA.close();
  }
});

test('nói chuyện với NPC trong làng thì hiện hội thoại', async ({ page }) => {
  await enterWorld(page);

  // Bấm vào NPC trên canvas: toạ độ lấy từ trạng thái thế giới để không phụ thuộc hằng số.
  const npcName = await page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: { npcNames(): string[] } }).__ninjaWorld;
    return api?.npcNames()[0] ?? null;
  });
  expect(npcName).not.toBeNull();

  await page.evaluate((name) => {
    (
      globalThis as unknown as { __ninjaWorld?: { clickEntity(name: string): void } }
    ).__ninjaWorld?.clickEntity(name ?? '');
  }, npcName);

  await expect(page.locator('.npc-dialog')).toContainText('Làng Khởi Nguồn');
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Luồng M1: đăng ký tài khoản → tạo nhân vật → tải lại trang vẫn giữ phiên.
 * Mỗi test dùng tên riêng sinh theo thời gian nên chạy lại nhiều lần vẫn đúng.
 */

const PASSWORD = 'matkhau123';

/** Tên nhân vật tối đa 12 ký tự (CHARACTER_NAME_MAX_LENGTH trong @ninja/shared). */
function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

function uniqueCharacterName(): string {
  return `N${uniqueSuffix().slice(-6)}`;
}

async function registerAccount(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.locator('.tab', { hasText: 'Tạo tài khoản' }).click();
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/characters$/);
}

async function createCharacter(page: Page, name: string, school = 'haruna'): Promise<void> {
  await page.fill('#character-name', name);
  await page.selectOption('#character-school', school);
  await page.locator('form button[type=submit]').click();
}

test('đăng ký rồi tạo nhân vật, tải lại trang vẫn còn phiên và còn nhân vật', async ({ page }) => {
  const username = `e2e${uniqueSuffix()}`;
  const characterName = uniqueCharacterName();

  await registerAccount(page, username);
  await expect(page.locator('.account')).toContainText(username);
  await expect(page.locator('.hint').first()).toContainText('Bạn chưa có nhân vật nào');

  await createCharacter(page, characterName);

  await expect(page.locator('.list .card h2')).toHaveText(characterName);
  await expect(page.locator('.list .card')).toContainText('Haruna');
  await expect(page.locator('.list .card')).toContainText('Đao');
  await expect(page.locator('.list .card')).toContainText('Cấp');

  // Tải lại trang: phiên được khôi phục từ localStorage, nhân vật vẫn nằm trong danh sách.
  await page.reload();
  await expect(page).toHaveURL(/\/characters$/);
  await expect(page.locator('.list .card h2')).toHaveText(characterName);
});

test('đăng nhập lại bằng mật khẩu đã đặt thì thấy nhân vật cũ', async ({ page }) => {
  const username = `e2e${uniqueSuffix()}`;
  const characterName = uniqueCharacterName();

  await registerAccount(page, username);
  await createCharacter(page, characterName);
  await expect(page.locator('.list .card h2')).toHaveText(characterName);

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Route được bảo vệ: chưa đăng nhập thì bị đẩy về trang đăng nhập.
  await page.goto('/characters');
  await expect(page).toHaveURL(/\/login/);

  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('.list .card h2')).toHaveText(characterName);
});

test('sai mật khẩu bị chặn và hiện thông báo', async ({ page }) => {
  const username = `e2e${uniqueSuffix()}`;
  await registerAccount(page, username);
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.fill('#username', username);
  await page.fill('#password', 'sai-mat-khau-9999');
  await page.locator('form button[type=submit]').click();

  await expect(page.locator('.alert')).toContainText('không đúng');
  await expect(page).toHaveURL(/\/login$/);
});

test('kiểm tra dữ liệu ngay trên trình duyệt, không gọi API khi biểu mẫu sai', async ({ page }) => {
  await page.goto('/login');
  await page.locator('.tab', { hasText: 'Tạo tài khoản' }).click();

  let apiCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/')) {
      apiCalls += 1;
    }
  });

  await page.fill('#username', 'Ten Co Dau Cach');
  await page.fill('#password', 'ngan');
  await page.locator('form button[type=submit]').click();

  await expect(page.locator('.field .error').first()).toBeVisible();
  expect(apiCalls).toBe(0);
});

test('chọn trường thì chỉ hiện hai phái của trường đó', async ({ page }) => {
  await registerAccount(page, `e2e${uniqueSuffix()}`);

  await expect(page.locator('#character-class option')).toHaveText(['Đao', 'Quạt']);

  await page.selectOption('#character-school', 'ookaza');
  await expect(page.locator('#character-class option')).toHaveText(['Kunai', 'Cung']);

  await page.selectOption('#character-school', 'hirosaki');
  await expect(page.locator('#character-class option')).toHaveText(['Kiếm', 'Phiêu Tiêu']);
});

test('tên nhân vật trùng thì server từ chối và giao diện báo lỗi', async ({ page, browser }) => {
  const username = `e2e${uniqueSuffix()}`;
  const characterName = uniqueCharacterName();

  await registerAccount(page, username);
  await createCharacter(page, characterName);
  await expect(page.locator('.list .card h2')).toHaveText(characterName);

  // Tài khoản khác (ngữ cảnh trình duyệt riêng) thử lấy cùng tên, không phân biệt hoa thường.
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  try {
    await registerAccount(secondPage, `e2e${uniqueSuffix()}`);
    await createCharacter(secondPage, characterName.toUpperCase());
    await expect(secondPage.locator('.alert')).toContainText('đã có người dùng');
  } finally {
    await secondContext.close();
  }
});

test('tên nhân vật dài quá 12 ký tự bị chặn ngay trên trình duyệt', async ({ page }) => {
  await registerAccount(page, `e2e${uniqueSuffix()}`);

  await page.fill('#character-name', 'TenNhanVatQuaDai');
  await page.locator('form button[type=submit]').click();

  await expect(page.locator('.field .error').first()).toContainText('tối đa 12 ký tự');
  await expect(page.locator('.list .card')).toHaveCount(0);
});

test('đăng xuất thu hồi refresh token ở máy chủ: token cũ không dùng lại được', async ({
  page,
}) => {
  await registerAccount(page, `e2e${uniqueSuffix()}`);

  const refreshToken = await page.evaluate(() => localStorage.getItem('ninja.refreshToken'));
  expect(refreshToken).toBeTruthy();

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('ninja.refreshToken'))).toBeNull();

  // Máy chủ phải đã thu hồi token: dùng lại token cũ để làm mới phiên phải bị từ chối.
  const response = await page.request.post('/api/auth/refresh', { data: { refreshToken } });
  expect(response.status()).toBe(401);
});
